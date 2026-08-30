/* =========================================================================
   MediShelf - shared auth + API helper.
   Loaded by every page, before that page's own script.

   This talks to window.MediMock (mock-backend.js) instead of a real Django
   server, but keeps the exact same request/response contract the rest of
   the frontend already expects, so app.js / distributor.js / notifications.js
   needed no changes.
   ========================================================================= */

window.MediAuth = (function () {
  "use strict";

  var TOKEN_KEY = "medishelf_token";
  var USER_KEY = "medishelf_user";

  function token() { return localStorage.getItem(TOKEN_KEY) || ""; }

  function user() {
    try { return JSON.parse(localStorage.getItem(USER_KEY) || "null"); }
    catch (e) { return null; }
  }

  function save(tok, usr) {
    localStorage.setItem(TOKEN_KEY, tok);
    localStorage.setItem(USER_KEY, JSON.stringify(usr));
  }

  function clear() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }

  /* Every API call goes through here, so the token is attached once. */
  function api(path, options) {
    options = options || {};
    var headers = options.headers || {};
    headers["Content-Type"] = "application/json";
    if (token()) headers["Authorization"] = "Token " + token();
    options.headers = headers;

    return window.MediMock.request(path, options).catch(function (err) {
      if (err && err.status === 401) {          // token expired or missing
        clear();
        location.href = "login.html";
        throw new Error("Please log in again.");
      }
      throw new Error((err && err.message) || "Something went wrong.");
    });
  }

  /* Login does not need a token yet, so it is a separate helper. */
  function login(username, password) {
    return window.MediMock.request("/auth/login/", {
      method: "POST",
      body: JSON.stringify({ username: username, password: password })
    });
  }

  /*
     Page guard. Call at the top of a panel page with the role it belongs to.
     Sends the wrong role to its own panel, and anyone logged out to login.
  */
  function guard(requiredRole) {
    var u = user();
    if (!token() || !u) { location.href = "login.html"; return null; }
    if (u.role !== requiredRole) { location.href = u.panel; return null; }
    return u;
  }

  function logout() {
    var done = function () { clear(); location.href = "login.html"; };
    api("/auth/logout/", { method: "POST" }).then(done).catch(done);
  }

  return {
    api: api, guard: guard, logout: logout, login: login,
    save: save, clear: clear, user: user, token: token
  };
})();
