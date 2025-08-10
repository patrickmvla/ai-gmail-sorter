import * as tf from "@tensorflow/tfjs-node";
import { promises as fs } from "fs";

const MODEL_DIR = "./model";
const VOCAB_PATH = `${MODEL_DIR}/vocabulary.json`;
const MODEL_PATH = `file://${MODEL_DIR}/model.json`;
const LABELS_PATH = `${MODEL_DIR}/labels.json`;

const VOCAB_SIZE = 5000;
const MAX_SEQUENCE_LENGTH = 100;

type TrainingData = {
  content: string;
  label: string;
}[];

type Vocabulary = { [word: string]: number };

function createVocabulary(emails: TrainingData): Vocabulary {
  console.log("Creating vocabulary from email content...");
  const wordCounts: { [word: string]: number } = {};

  for (const email of emails) {
    const cleanedText = email.content.toLowerCase().replace(/[^\w\s]/g, "");
    const tokens = cleanedText.split(/\s+/).filter((token) => token.length > 0);

    for (const token of tokens) {
      wordCounts[token] = (wordCounts[token] || 0) + 1;
    }
  }

  const sortedWords = Object.keys(wordCounts).sort(
    (a, b) => wordCounts[b] - wordCounts[a]
  );
  const topWords = sortedWords.slice(0, VOCAB_SIZE - 2);

  const vocabulary: Vocabulary = {
    "<PAD>": 0,
    "<UNK>": 1,
  };
  for (let i = 0; i < topWords.length; i++) {
    vocabulary[topWords[i]] = i + 2;
  }

  console.log(
    `Vocabulary created with ${Object.keys(vocabulary).length} words.`
  );
  return vocabulary;
}

function padSequence(
  sequence: number[],
  maxLength: number,
  paddingValue = 0
): number[] {
  if (sequence.length >= maxLength) {
    return sequence.slice(0, maxLength);
  }
  const padded = [...sequence];
  while (padded.length < maxLength) {
    padded.push(paddingValue);
  }
  return padded;
}

function textToSequence(text: string, vocabulary: Vocabulary): number[] {
  const cleanedText = text.toLowerCase().replace(/[^\w\s]/g, "");
  const tokens = cleanedText.split(/\s+/).filter((token) => token.length > 0);
  const sequence = tokens.map(
    (token) => vocabulary[token] || vocabulary["<UNK>"]
  );

  return padSequence(sequence, MAX_SEQUENCE_LENGTH);
}

function createModel(numClasses: number): tf.Sequential {
  const model = tf.sequential();

  const glorotNormal = tf.initializers.glorotNormal({ seed: 42 });

  model.add(
    tf.layers.embedding({
      inputDim: VOCAB_SIZE,
      outputDim: 32,
      inputLength: MAX_SEQUENCE_LENGTH,
      embeddingsInitializer: glorotNormal,
    })
  );

  model.add(
    tf.layers.bidirectional({
      layer: tf.layers.lstm({
        units: 32,
        recurrentDropout: 0.2,
        kernelInitializer: glorotNormal,
        recurrentInitializer: "orthogonal", // A standard choice for LSTMs
      }),
      mergeMode: "concat",
    })
  );

  model.add(tf.layers.dropout({ rate: 0.5, seed: 42 }));
  model.add(
    tf.layers.dense({
      units: 24,
      activation: "relu",
      kernelInitializer: glorotNormal,
    })
  );
  model.add(
    tf.layers.dense({
      units: numClasses,
      activation: "softmax",
      kernelInitializer: glorotNormal,
    })
  );

  model.compile({
    loss: "categoricalCrossentropy",
    optimizer: "adam",
    metrics: ["accuracy"],
  });

  model.summary();
  return model;
}

export async function trainModel(emails: TrainingData) {
  if (emails.length === 0) {
    console.error("Cannot train model: No training data provided.");
    return;
  }

  const vocabulary = createVocabulary(emails);
  await fs.mkdir(MODEL_DIR, { recursive: true });
  await fs.writeFile(VOCAB_PATH, JSON.stringify(vocabulary));

  const sequences = emails.map((email) =>
    textToSequence(email.content, vocabulary)
  );
  const labels = emails.map((email) => email.label);

  const uniqueLabels = [...new Set(labels)];
  const labelMap = Object.fromEntries(
    uniqueLabels.map((label, i) => [label, i])
  );
  const numericLabels = labels.map((label) => labelMap[label]);

  const xs = tf.tensor2d(sequences, [sequences.length, MAX_SEQUENCE_LENGTH]);
  const ys = tf.oneHot(
    tf.tensor1d(numericLabels, "int32"),
    uniqueLabels.length
  );

  const model = createModel(uniqueLabels.length);

  console.log("\nStarting model training...");
  await model.fit(xs, ys, {
    epochs: 15,
    batchSize: 32,
    shuffle: true,
    validationSplit: 0.2,
    callbacks: tf.callbacks.earlyStopping({ monitor: "val_loss", patience: 3 }),
  });
  console.log("Model training complete.");

  await model.save(MODEL_PATH);
  console.log(`Model saved to ${MODEL_DIR}`);

  await fs.writeFile(`${MODEL_DIR}/labels.json`, JSON.stringify(uniqueLabels));

  console.log("Cleaning up tensors...");
  xs.dispose();
  ys.dispose();
  model.dispose();
  console.log("Cleanup complete.");
}

export class Classifier {
  private model: tf.LayersModel | null = null;
  private vocabulary: Vocabulary | null = null;
  private labels: string[] | null = null;

  constructor() {}

  async load() {
    console.log("Loading model and vocabulary...");
    try {
      this.model = await tf.loadLayersModel(MODEL_PATH);
      const vocabData = await fs.readFile(VOCAB_PATH, "utf8");
      this.vocabulary = JSON.parse(vocabData);
      const labelsData = await fs.readFile(LABELS_PATH, "utf8");
      console.log("Classifier loaded successfully.");
    } catch (error) {
      console.error("Error loading classifier:", error);
      console.error(
        "Please make sure you have run the training script (`bun run train`) first."
      );
      process.exit(1);
    }
  }

  predict(emailContent: string): string | null {
    if (!this.model || !this.vocabulary || !this.labels) {
      console.error("Classifier not loaded. Call load() first.");
      return null;
    }

    const sequence = textToSequence(emailContent, this.vocabulary);
    const tensor = tf.tensor2d([sequence]);

    const prediction = this.model.predict(tensor) as tf.Tensor;
    const predictedIndex = prediction.argMax(-1).dataSync()[0];

    tf.dispose([tensor, prediction]);

    return this.labels[predictedIndex];
  }
}
