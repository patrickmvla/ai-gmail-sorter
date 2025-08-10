import { google } from "googleapis";
import { getAuthenticatedClient, getEmailsForLabel } from "../api/gmail";
import { LABELS_TO_TRAIN } from "../config";
import { trainModel } from "../ml/classifier";

const main = async () => {
  console.log("--- Starting Gmail AI Sorter Training ---");

  console.log("\nStep 1: Authenticating...");
  const auth = await getAuthenticatedClient();
  console.log("Authentication successful!");

  const gmail = google.gmail({ version: "v1", auth });

  console.log("Setting up Gmail watch...");
  await gmail.users.watch({
    userId: "me",
    requestBody: {
      topicName: "projects/gmail-ai-sorter-468313/topics/gmail-new-email",
      labelIds: ["INBOX"],
    },
  });
  console.log("Gmail watch configured successfully.");

  console.log("\nStep 2: Fetching training data...");
  const allEmails: { content: string; label: string }[] = [];
  const emailsPerLabel = 500;

  for (const labelName of LABELS_TO_TRAIN) {
    const emails = await getEmailsForLabel(gmail, labelName, emailsPerLabel);
    allEmails.push(...emails);
  }

  if (allEmails.length === 0) {
    console.error(
      "\nError: No training data found. Make sure the labels in `config.ts` exist and contain emails."
    );
    console.error("Exiting training process.");
    return;
  }
  console.log(`\nTotal emails fetched for training: ${allEmails.length}`);

  //  Train the machine learning model.
  console.log("\nStep 3: Training the model...");
  await trainModel(allEmails);

  console.log("\n--- Training Process Finished Successfully! ---");
  console.log("The model is now saved in the `/model` directory.");
};

main().catch(console.error);
