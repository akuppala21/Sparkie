Build me a tiny web app in a new folder `app/` that lets me chat with the brain:
- a page at `/` with a text box and a send button, showing the brain's reply;
- an endpoint `POST /api/chat` that takes JSON `{"message": "..."}` and returns JSON `{"reply": "..."}` with the
  brain's answer.

The brain is an OpenAI-compatible server at {{BRAIN_URL}}, model `{{BRAIN_MODEL}}`; it needs no API key. Use Node.js
only, with no npm packages. Start the app on port {{APP_PORT}} so it keeps running after you finish, then check that
it really answers. Tell me how to open it.
