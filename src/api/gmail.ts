import { promises as fs } from "fs";
import { CREDENTIALS_PATH, SCOPES, TOKEN_PATH } from "../config";
import type { OAuth2Client } from "google-auth-library";
import { gmail_v1, google } from "googleapis";
import * as http from "http";
import * as url from "url";
import open from "open";

const loadCredentials = async () => {
  try {
    const content = await fs.readFile(CREDENTIALS_PATH, "utf8");
    return JSON.parse(content);
  } catch (err) {
    console.error(`Errors loading credentials file from ${CREDENTIALS_PATH},`);
    console.error(
      "Please make sure you have downloaded your credentials from the Google Cloud Console and placed them in the root directory."
    );
    process.exit(1);
  }
};

export const getAuthenticatedClient = async (): Promise<OAuth2Client> => {
  const credentials = await loadCredentials();
  const { client_secret, client_id, redirect_uris } = credentials.web;
  const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris[0]
  );

  try {
    const token = await fs.readFile(TOKEN_PATH, "utf8");
    oAuth2Client.setCredentials(JSON.parse(token));
    return oAuth2Client;
  } catch (err) {
    return getNewToken(oAuth2Client);
  }
};

const getNewToken = async (
  oAuth2Client: OAuth2Client
): Promise<OAuth2Client> => {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
  });

  return new Promise((resolve, reject) => {
    console.log("Authorize this app by visiting this url:", authUrl);

    open(authUrl);

    const server = http
      .createServer(async (req, res) => {
        try {
          if (req.url) {
            const qs = new url.URL(req.url, "http://localhost:3000")
              .searchParams;
            const code = qs.get("code");

            if (code) {
              res.end("Authentication successful! You can close this tab.");

              const { tokens } = await oAuth2Client.getToken(code);
              oAuth2Client.setCredentials(tokens);

              await fs.writeFile(TOKEN_PATH, JSON.stringify(tokens));
              console.log("Token stored to", TOKEN_PATH);

              server.close();
              resolve(oAuth2Client);
            } else {
              // Ignore other requests (like for favicon.ico)
              res.end("Waiting for Google's authorization redirect...");
            }
          }
        } catch (e) {
          reject(e);
        }
      })
      .listen(3000, () => {
        console.log("Server listening on http://localhost:3000");
      });
  });
};

// const parseEmailBody = (
//   parts: gmail_v1.Schema$MessagePart[] | undefined
// ): string => {
//   if (!parts) {
//     return "";
//   }

//   for (const part of parts) {
//     if (part.mimeType === "text/plain" && part.body?.data) {
//       return Buffer.from(part.body.data, "base64").toString("utf8");
//     }

//     if (part.parts) {
//       const body = parseEmailBody(part.parts);
//       if (body) {
//         return body;
//       }
//     }
//   }
//   return "";
// };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const parseEmailBody = (
  parts: gmail_v1.Schema$MessagePart[] | undefined
): string => {
  if (!parts) {
    return "";
  }

  for (const part of parts) {
    if (part.mimeType === "text/plain" && part.body?.data) {
      return Buffer.from(part.body.data, "base64").toString("utf8");
    }

    if (part.parts) {
      const body = parseEmailBody(part.parts);
      if (body) {
        return body;
      }
    }
  }
  return "";
};

export const getEmailsForLabel = async (
  gmail: gmail_v1.Gmail,
  labelOrCategory: string,
  maxResults: number
) => {
  console.log(`\nFetching emails for: "${labelOrCategory}"...`);

  const knownCategories = [
    "primary",
    "social",
    "promotions",
    "updates",
    "forums",
  ];
  const query = knownCategories.includes(labelOrCategory.toLowerCase())
    ? `category:${labelOrCategory.toLowerCase()}`
    : `label:${labelOrCategory.toLowerCase().replace(" ", "-")}`;

  console.log(`  - Using query: "${query}"`);

  const trainingData: { content: string; label: string }[] = [];
  let nextPageToken: string | undefined | null = undefined;

  while (trainingData.length < maxResults) {
    const listResponse = await gmail.users.messages.list({
      userId: "me",
      q: query,
      maxResults: Math.min(50, maxResults - trainingData.length),
      pageToken: nextPageToken || undefined,
    });

    const messages = listResponse.data.messages;
    if (!messages || messages.length === 0) {
      console.log("  - No more messages found for this query.");
      break;
    }

    // **FIX:** Process messages in smaller chunks to avoid hitting rate limits.
    const chunkSize = 10;
    for (let i = 0; i < messages.length; i += chunkSize) {
      const chunk = messages.slice(i, i + chunkSize);

      const emailPromises = chunk.map(async (message) => {
        if (message.id) {
          const email = await gmail.users.messages.get({
            userId: "me",
            id: message.id,
            format: "full",
          });
          return email.data;
        }
        return null;
      });

      const emails = await Promise.all(emailPromises);

      for (const email of emails) {
        if (email) {
          const headers = email.payload?.headers;
          const subject =
            headers?.find((h) => h.name === "Subject")?.value || "";
          const body = parseEmailBody(email.payload?.parts);

          if (body) {
            trainingData.push({
              content: `${subject} ${body}`.replace(/\s+/g, " ").trim(),
              label: labelOrCategory,
            });
          }
        }
      }
      process.stdout.write(
        `  - Fetched ${trainingData.length}/${maxResults} emails...\r`
      );
      await sleep(250); // Pause for 250ms between chunks
    }

    nextPageToken = listResponse.data.nextPageToken;
    if (!nextPageToken) {
      break;
    }
  }

  console.log(
    `\n  - Finished fetching for "${labelOrCategory}". Total emails: ${trainingData.length}`
  );
  return trainingData;
};

// --- for Real-Time Sorting ---

export const getEmailContent = async (
  gmail: gmail_v1.Gmail,
  messageId: string
): Promise<string | null> => {
  try {
    const email = await gmail.users.messages.get({
      userId: "me",
      id: messageId,
      format: "full",
    });

    if (email.data) {
      const headers = email.data.payload?.headers;
      const subject = headers?.find((h) => h.name === "Subject")?.value || "";
      const body = parseEmailBody(email.data.payload?.parts);
      return `${subject} ${body}`.replace(/\s+/g, "").trim();
    }
    return null;
  } catch (error) {
    console.error(`Error fetching email ${messageId}:`, error);
    return null;
  }
};

export const applyLabelToEmail = async (
  gmail: gmail_v1.Gmail,
  messageId: string,
  labelName: string
) => {
  try {
    const res = await gmail.users.labels.list({ userId: "me" });
    const label = res.data.labels?.find((l) => l.name === labelName);

    if (!label || !label.id) {
      console.warn(`Label "${labelName}" not found. Cannot apply.`);
      return;
    }

    await gmail.users.messages.modify({
      userId: "me",
      id: messageId,
      requestBody: {
        addLabelIds: [label.id],
      },
    });
    console.log(
      `Successfully applied label "${labelName}" to message ${messageId}.`
    );
  } catch (error) {
    console.error(`Error applying label to ${messageId}:`, error);
  }
};
