DAYFLOW AI — AI COACH SETUP

FILES
- index.html: page structure
- style.css: styling
- script.js: task planner and chat interface
- server.js: secure backend endpoint for AI Coach
- package.json: Node.js dependencies and commands
- .env.example: template for local API settings

RUN LOCALLY
1. Put all files in the same project folder.
2. Open Command Prompt in that folder.
3. Run: npm install
4. Copy .env.example to a new file named .env.
5. Put your own OpenAI API key in .env after OPENAI_API_KEY= . Do not share or upload .env.
6. Run: npm start
7. Open http://localhost:3000

AI AVAILABILITY
If an API key and usable API credits are configured, the coach uses the OpenAI API.
If the key is missing or API quota is unavailable, a clearly labelled basic backup coach answers common planning prompts. Basic mode is not a full AI model. Full AI responses require available API credits; a ChatGPT subscription does not automatically provide API credits.

SECURITY
- Keep .env private and never place API keys in script.js or index.html.
- The backend limits chat requests and message sizes.
- The planner stores task data in this browser's local storage on this device.
