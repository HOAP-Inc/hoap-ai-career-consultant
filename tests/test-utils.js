const handler = require("../pages/api/chat.js");

function createResponse() {
  const res = {
    statusCode: 200,
    body: null,
  };
  res.status = function status(code) {
    this.statusCode = code;
    return this;
  };
  res.json = function json(payload) {
    this.body = payload;
    if (typeof this._resolve === "function") {
      this._resolve({ statusCode: this.statusCode, body: payload });
    }
  };
  res.promise = new Promise((resolve) => {
    res._resolve = resolve;
  });
  return res;
}

async function callApi(sessionId, message) {
  const req = {
    method: "POST",
    body: { sessionId, message },
  };
  const res = createResponse();
  const pending = res.promise;
  await handler(req, res);
  return pending;
}

module.exports = { callApi };
