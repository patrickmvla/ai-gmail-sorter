# AI Gmail Sorter

This project is a "headless" AI agent that automatically learns your email organization habits and sorts new, incoming mail into the correct categories within your Gmail account.

It uses a custom-trained neural network to classify emails based on their content, running as a 24/7 background service to keep your inbox tidy.

## Features

* **Intelligent Learning:** Analyzes your existing emails from categories like `Primary`, `Promotions`, `Social`, or your own custom labels to train a personalized classification model.
* **Real-Time Sorting:** Uses Google Cloud Pub/Sub push notifications to sort new emails almost instantly as they arrive.
* **Headless Service:** Runs as a lightweight backend application with no frontend required. The results of its work are visible directly in your Gmail interface.
* **Modern Tech Stack:** Built with a high-performance, modern TypeScript stack including Bun, Hono, and TensorFlow.js.

## Technology Stack

* **Runtime:** [Bun](https://bun.sh/)
* **Web Framework:** [Hono](https://hono.dev/)
* **Language:** [TypeScript](https://www.typescriptlang.org/)
* **Machine Learning:** [TensorFlow.js](https://www.tensorflow.org/js)
* **Google Cloud Services:**
    * Gmail API
    * Google Cloud Pub/Sub
* **Deployment:** [Render](https://render.com)

## How It Works

The project is divided into two main phases:

1.  **Phase 1: Training (`bun run train`)**
    * A command-line script authenticates with your Google account using OAuth 2.0.
    * It fetches hundreds of emails from the labels you specify in the configuration.
    * It processes this text data to build a vocabulary and trains a custom TensorFlow.js neural network (specifically, a Bidirectional LSTM model).
    * The trained model, vocabulary, and label list are saved to the `/model` directory.
2.  **Phase 2: Real-Time Sorting (`bun run start`)**
    * A lightweight Hono server starts and loads the saved model from the `/model` directory.
    * This server listens for incoming webhook notifications from Google Cloud Pub/Sub, which are triggered by new emails.
    * When a notification arrives, the server fetches the new email's content, uses the loaded model to predict its category, and then uses the Gmail API to apply the correct label.

## Setup and Installation

### Prerequisites

* [Bun](https://bun.sh/docs/installation) installed on your machine.
* A Google Cloud Project.

### 1. Clone the Repository

```sh
git clone <your-repository-url>
cd gmail-ai-sorter
```

### 2. Install Dependencies

```sh
bun install
```

### 3. Configure Google Cloud Credentials

* Follow the official guide to [create a Google Cloud Project and enable the Gmail API](https://developers.google.com/gmail/api/quickstart/nodejs#setup).
* Create an **OAuth 2.0 Client ID** for a **Web application**.
* In the "Authorized redirect URIs" section, add `http://localhost:3000`.
* Download the credentials JSON file, rename it to `credentials.json`, and place it in the root of the project directory.

### 4. Configure Training Labels

* Open `src/config.ts`.
* Modify the `LABELS_TO_TRAIN` array to include the Gmail labels or categories you want the AI to learn from.

```typescript
// src/config.ts
export const LABELS_TO_TRAIN = [
    'Primary',
    'Promotions',
    'Social',
    'Work' // Add your own custom labels
];
```

## Usage

### 1. Train the Model

Run the training script from your terminal. This is a one-time process that you only need to repeat if you want to retrain the model on newer emails.

```sh
bun run src/scripts/train.ts
```

The first time you run this, a browser window will open asking you to authorize the application. After you grant permission, a `token.json` file will be created, and the script will proceed to fetch data and train the model.

### 2. Run the Sorting Server

To run the server locally for testing, use the start command:

```sh
bun run start
```

This will start the Hono server, which will load the trained model and be ready to receive webhook notifications.

## Deployment

This project is designed to be deployed as a background service on a platform like Render.

1.  **Push to GitHub:** Make sure your project, including the generated `/model` directory, is pushed to a GitHub repository. Your `.gitignore` should exclude `node_modules/`, `credentials.json`, and `token.json`.
2.  **Create a Render Web Service:**
    * Connect your GitHub repository.
    * Use the following settings:
        * **Runtime:** `Node`
        * **Build Command:** `bun install`
        * **Start Command:** `bun src/server.ts`
3.  **Add Environment Files:** In the Render "Environment" tab, create two **Secret Files**:
    * `credentials.json`: Paste the content of your local `credentials.json` file.
    * `token.json`: Paste the content of your local `token.json` file.
4.  **Configure Pub/Sub:** Set up a Google Cloud Pub/Sub topic and a push subscription that points to your Render service's webhook URL (`https://your-app-name.onrender.com/webhook`).
5.  **Enable Gmail Watch:** Run the one-time watch command (as detailed in the deployment guide) to link your Gmail inbox to the Pub/Sub topic.
