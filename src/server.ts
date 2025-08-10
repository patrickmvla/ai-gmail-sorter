import { Hono } from "hono";
import { google, gmail_v1 } from "googleapis";
import {
  getAuthenticatedClient,
  getEmailContent,
  applyLabelToEmail,
} from "./api/gmail.js";
import { Classifier } from "./ml/classifier.js";
import { OAuth2Client } from "google-auth-library";

let gmail: gmail_v1.Gmail;
const classifier = new Classifier();

/**
 * Initializes the application by authenticating with Google and loading the ML model.
 */
async function initializeApp() {
  console.log("Initializing application...");
  const auth: OAuth2Client = await getAuthenticatedClient();
  gmail = google.gmail({ version: "v1", auth });
  await classifier.load();
  console.log("Application initialized successfully.");
}

const app = new Hono();

app.get("/", (c) => {
  return c.text("AI Gmail Sorter is running!");
});

/**
 * This is the webhook endpoint that Google Pub/Sub will call.
 * It receives a notification, fetches the email, predicts its category,
 * and applies the appropriate label.
 */
app.post("/webhook", async (c) => {
  try {
    const body = await c.req.json();
    console.log(
      "Webhook notification received:",
      JSON.stringify(body, null, 2)
    );

    const messageData = JSON.parse(
      Buffer.from(body.message.data, "base64").toString("utf-8")
    );
    const emailAddress = messageData.emailAddress;
    const historyId = messageData.historyId;

    console.log(`New email for ${emailAddress}. History ID: ${historyId}`);

    const historyResponse = await gmail.users.history.list({
      userId: "me",
      startHistoryId: historyId,
      historyTypes: ["messageAdded"],
    });

    const addedMessages = historyResponse.data.history?.[0]?.messagesAdded;
    if (!addedMessages || addedMessages.length === 0) {
      console.log("No new messages found in history record.");
      return c.json({ success: true, message: "No new messages in history." });
    }

    const messageId = addedMessages[0].message?.id;
    if (!messageId) {
      console.log("Message ID not found.");
      return c.json({ success: true, message: "Message ID missing." });
    }

    console.log(`Processing new message ID: ${messageId}`);

    const content = await getEmailContent(gmail, messageId);
    if (!content) {
      console.log(`Could not retrieve content for message ${messageId}.`);
      return c.json({ success: false, message: "Content fetch failed." });
    }

    const predictedLabel = classifier.predict(content);
    if (!predictedLabel) {
      console.log("Could not predict a label.");
      return c.json({ success: false, message: "Prediction failed." });
    }
    console.log(`Predicted label: "${predictedLabel}"`);

    await applyLabelToEmail(gmail, messageId, predictedLabel);

    return c.json({ success: true, predictedLabel });
  } catch (error) {
    console.error("Error processing webhook:", error);
    return c.json({ success: false, error: "Internal Server Error" }, 500);
  }
});

initializeApp().then(() => {
  console.log("Starting server on port 3000...");
});

export default {
  port: 3000,
  fetch: app.fetch,
};
