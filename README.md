# DayFlow AI — AI Coach setup

This folder keeps the existing task planner and adds a real AI Coach endpoint.

## Requirements
- Node.js installed
- An OpenAI API key from your own API account (API access/billing may be separate from a ChatGPT subscription)

## Setup in Windows PowerShell
1. Extract this folder somewhere you can edit it in VS Code.
2. Open the `dayflow-ai-coach` folder in VS Code.
3. In the VS Code terminal, run:

   ```powershell
   npm.cmd install
   ```

4. Copy `.env.example` to a new file named `.env` in the same folder.
5. Open `.env` and replace the example value with your private API key. Do not paste the key into chat or `script.js`. Do not share the `.env` file.
6. Start the server:

   ```powershell
   npm.cmd start
   ```

7. Open `http://localhost:3000` in your browser. Do not open `index.html` by double-clicking it; the AI endpoint needs the server.
8. Keep the terminal window open while using the website. To stop the server, press `Ctrl+C` in that terminal.

## How it works
- `index.html` contains the UI.
- `style.css` styles the UI.
- `script.js` keeps the task planner and sends chat messages to `/api/chat`.
- `server.js` validates requests and calls the OpenAI Responses API. The key stays on the server.
- `.env` holds your private local settings and is ignored by Git.

The coach can read the tasks currently in the browser and use them as context for the current chat request. Tasks and chat history are not saved permanently yet; refreshing the page clears them. The server includes a small per-IP rate limit, but this is a learning prototype, not a production-ready public deployment. Before publishing it, add real authentication, stronger abuse prevention, and production hosting/security settings.
