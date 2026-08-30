/* =========================================================================
   MediShelf - the notification bell.
   Shared by the pharmacy and distributor panels.

   Read state lives in localStorage as a list of seen notification ids, so
   the badge only counts what you have not looked at yet. Notification ids
   are stable, so an order moving to the next stage produces a new one.
   ========================================================================= */

window.MediNotify = (function () {
  "use strict";

  var SEEN_KEY = "medishelf_seen_notifications";
  var POLL_MS = 30000;

  var state = { items: [], open: false, onNavigate: null };

  function seen() {
    try { return JSON.parse(localStorage.getItem(SEEN_KEY) || "[]"); }
    catch (e) { return []; }
  }

  function markSeen(ids) {
    var all = seen().concat(ids);
    // keep the list from growing forever
    localStorage.setItem(SEEN_KEY, JSON.stringify(all.slice(-200)));
  }

  function unreadCount() {
    var s = seen();
    return state.items.filter(function (n) { return s.indexOf(n.id) === -1; }).length;
  }

  function esc(str) {
    return String(str).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function timeAgo(iso) {
    if (!iso) return "";
    var mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return mins + "m ago";
    var hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + "h ago";
    return Math.floor(hrs / 24) + "d ago";
  }

  var ICON = {
    danger:  '<path d="M12 4 3 20h18L12 4Z"/><path d="M12 10v4M12 17h.01"/>',
    warning: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    success: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
    info:    '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>'
  };

  function render() {
    var list = document.getElementById("notifList");
    var badge = document.getElementById("bellDot");
    var count = unreadCount();

    if (badge) {
      badge.className = count ? "dot on" : "dot";
      badge.textContent = count > 9 ? "9+" : (count || "");
    }

    var countEl = document.getElementById("notifCount");
    if (countEl) {
      countEl.textContent = count ? count + " new" : "All caught up";
    }

    if (!list) return;

    if (!state.items.length) {
      list.innerHTML = '<p class="notif-empty">Nothing needs your attention.</p>';
      return;
    }

    var s = seen();
    list.innerHTML = state.items.map(function (n) {
      var isNew = s.indexOf(n.id) === -1;
      return '<button class="notif-item' + (isNew ? " is-new" : "") +
             '" data-nid="' + esc(n.id) + '" data-view="' + esc(n.view || "") + '">' +
             '<span class="notif-ico notif-' + esc(n.level) + '">' +
             '<svg viewBox="0 0 24 24">' + (ICON[n.level] || ICON.info) + "</svg></span>" +
             '<span class="notif-body">' +
             "<b>" + esc(n.title) + "</b>" +
             "<span>" + esc(n.message) + "</span>" +
             (n.when ? '<em class="notif-time">' + esc(timeAgo(n.when)) + "</em>" : "") +
             "</span></button>";
    }).join("");
  }

  function load() {
    return MediAuth.api("/notifications/").then(function (d) {
      state.items = d.notifications;
      render();
      return d;
    }).catch(function () { /* stay quiet - the bell is not critical */ });
  }

  function toggle(force) {
    var panel = document.getElementById("notifPanel");
    if (!panel) return;
    state.open = (force === undefined) ? !state.open : force;
    panel.hidden = !state.open;
    if (state.open) render();
  }

  /*
     Builds the dropdown next to an existing bell button and wires it up.
     onNavigate(view) is called when a notification is clicked, so each panel
     can switch to its own section.
  */
  function mount(options) {
    options = options || {};
    state.onNavigate = options.onNavigate || function () {};

    var bell = document.getElementById("bellBtn");
    if (!bell) return;

    var wrap = document.createElement("div");
    wrap.className = "notif-wrap";
    bell.parentNode.insertBefore(wrap, bell);
    wrap.appendChild(bell);

    var panel = document.createElement("div");
    panel.className = "notif-panel glass";
    panel.id = "notifPanel";
    panel.hidden = true;
    panel.innerHTML =
      '<div class="notif-head">' +
      "<h5>Notifications</h5>" +
      '<span id="notifCount">&mdash;</span>' +
      "</div>" +
      '<div class="notif-list" id="notifList"></div>' +
      '<div class="notif-foot">' +
      '<button class="notif-clear" id="notifClear">Mark all as read</button>' +
      "</div>";
    wrap.appendChild(panel);

    bell.addEventListener("click", function (e) {
      e.stopPropagation();
      toggle();
    });

    panel.addEventListener("click", function (e) {
      e.stopPropagation();

      if (e.target.closest("#notifClear")) {
        markSeen(state.items.map(function (n) { return n.id; }));
        render();
        return;
      }

      var item = e.target.closest("[data-nid]");
      if (!item) return;
      markSeen([item.getAttribute("data-nid")]);
      var view = item.getAttribute("data-view");
      toggle(false);
      if (view) state.onNavigate(view);
      render();
    });

    document.addEventListener("click", function () { toggle(false); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") toggle(false);
    });

    load();
    setInterval(load, POLL_MS);
  }

  return { mount: mount, refresh: load };
})();
