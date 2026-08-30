/* =========================================================================
   MediShelf - Distributor Panel.
   Mirrors the structure of app.js so both panels read the same way.
   ========================================================================= */

(function () {
  "use strict";

  var api = MediAuth.api;

  var state = {
    reqStatus: "",   // filter on the requests table
    query: "",
    orders: []
  };

  var $ = function (id) { return document.getElementById(id); };

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function taka(str) {
    var n = Number(str), whole = Math.trunc(n);
    var paisa = Math.round((n - whole) * 100);
    var s = whole.toLocaleString("en-US");
    if (paisa) s += "." + String(paisa).padStart(2, "0");
    return "\u09F3 " + s;
  }

  function toast(message, isError) {
    var el = $("toast");
    el.textContent = message;
    el.className = isError ? "toast err" : "toast";
    el.hidden = false;
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.hidden = true; }, 3200);
  }

  function emptyRow(cols, text) {
    return '<tr><td colspan="' + cols + '"><p class="empty">' + esc(text) + "</p></td></tr>";
  }

  function matchesSearch(o) {
    if (!state.query) return true;
    var q = state.query.toLowerCase();
    return o.pharmacy_name.toLowerCase().indexOf(q) > -1 ||
           o.medicine_name.toLowerCase().indexOf(q) > -1;
  }

  /* --------------------------- order requests -------------------------- */

  function loadOrders() {
    return api("/orders/incoming/").then(function (d) {
      state.orders = d.orders;
      var c = d.counts;

      $("reqStats").innerHTML = [
        ["Pending", c.pending], ["Accepted", c.accepted],
        ["Out for Delivery", c.out_for_delivery], ["Delivered", c.delivered],
        ["Rejected", c.rejected]
      ].map(function (x) {
        return '<div class="stat-cell"><b>' + x[1] + '</b><span class="tag tag-' +
               x[0].toLowerCase().replace(/ /g, "_") + '">' + esc(x[0]) + "</span></div>";
      }).join("");

      $("navPendingBadge").textContent = c.pending;
      $("topbarSub").textContent =
        d.total + " order" + (d.total === 1 ? "" : "s") + " total \u00B7 " +
        c.pending + " awaiting your decision";

      paintRequests();
      paintDeliveries();
    });
  }

  function paintRequests() {
    var rows = state.orders.filter(function (o) {
      return (!state.reqStatus || o.status === state.reqStatus) && matchesSearch(o);
    });

    if (!rows.length) {
      $("reqBody").innerHTML = emptyRow(6, "No order requests match this filter.");
      $("reqFoot").textContent = "0 requests";
      return;
    }

    $("reqBody").innerHTML = rows.map(function (o) {
      var action;
      if (o.status === "pending") {
        action = '<button class="btn-mini good" data-act="accepted" data-id="' + o.id + '">Accept</button>' +
                 '<button class="btn-mini danger" data-act="rejected" data-id="' + o.id + '">Reject</button>';
      } else if (o.status === "rejected") {
        action = '<span class="med-sub">Rejected</span>';
      } else {
        action = '<span class="med-sub">Moved to deliveries</span>';
      }

      return "<tr>" +
        '<td><div class="med">' + esc(o.pharmacy_name) + "</div>" +
        '<div class="med-sub">Order #' + o.id + "</div></td>" +
        '<td><div class="med">' + esc(o.medicine_name) + "</div></td>" +
        '<td class="num">' + o.quantity + " " + esc(o.unit.toLowerCase()) + "</td>" +
        '<td><span class="date">' + esc(o.ordered_at.slice(0, 10)) + "</span></td>" +
        '<td><span class="tag tag-' + o.status + '">' + esc(o.status_label) + "</span></td>" +
        "<td>" + action + "</td>" +
      "</tr>";
    }).join("");

    $("reqFoot").textContent = rows.length + " request" + (rows.length === 1 ? "" : "s") + " shown";
  }

  /* ----------------------------- deliveries ---------------------------- */

  var NEXT_LABEL = {
    out_for_delivery: "Mark Out for Delivery",
    delivered: "Mark Delivered"
  };

  function paintDeliveries() {
    var rows = state.orders.filter(function (o) {
      return ["accepted", "out_for_delivery", "delivered"].indexOf(o.status) > -1 &&
             matchesSearch(o);
    });

    if (!rows.length) {
      $("delBody").innerHTML = emptyRow(5, "No accepted orders yet. Accept a request first.");
      $("delFoot").textContent = "0 deliveries";
      return;
    }

    $("delBody").innerHTML = rows.map(function (o) {
      var next = o.next_statuses[0];
      var action = next
        ? '<button class="btn-mini warn" data-act="' + next + '" data-id="' + o.id + '">' +
          esc(NEXT_LABEL[next] || next) + "</button>"
        : (o.added_to_inventory
            ? '<span class="tag tag-safe">Added to pharmacy stock</span>'
            : '<span class="med-sub">Waiting for pharmacy to add stock</span>');

      return "<tr>" +
        '<td><div class="med">' + esc(o.pharmacy_name) + "</div>" +
        '<div class="med-sub">Order #' + o.id + "</div></td>" +
        '<td><div class="med">' + esc(o.medicine_name) + "</div></td>" +
        '<td class="num">' + o.quantity + " " + esc(o.unit.toLowerCase()) + "</td>" +
        '<td><span class="tag tag-' + o.status + '">' + esc(o.status_label) + "</span></td>" +
        "<td>" + action + "</td>" +
      "</tr>";
    }).join("");

    $("delFoot").textContent = rows.length + " in progress";
  }

  function changeStatus(id, status) {
    api("/orders/status/", {
      method: "POST",
      body: JSON.stringify({ order_id: Number(id), status: status })
    }).then(function (d) {
      toast("Order #" + d.order.id + " \u2192 " + d.order.status_label);
      MediNotify.refresh();
      return Promise.all([loadOrders(), loadMedicines()]);
    }).catch(function (e) { toast(e.message, true); });
  }

  /* ------------------------------ catalogue ---------------------------- */

  function loadMedicines() {
    return api("/orders/medicines/").then(function (d) {
      if (!d.medicines.length) {
        $("medBody").innerHTML = emptyRow(6, "No medicines yet. Add one above.");
        $("medFoot").textContent = "0 medicines";
        return;
      }
      $("medBody").innerHTML = d.medicines.map(function (m) {
        var low = m.available_quantity === 0;
        return "<tr>" +
          '<td><div class="med">' + esc(m.name) + "</div></td>" +
          "<td>" + esc(m.company || "\u2014") + "</td>" +
          "<td>" + esc(m.unit) + "</td>" +
          '<td class="num money">' + m.available_quantity + "</td>" +
          '<td class="num">' + taka(m.unit_price_bdt) + "</td>" +
          '<td><span class="tag ' + (low ? "tag-expired" : "tag-safe") + '">' +
          (low ? "Out of stock" : "Available") + "</span></td>" +
        "</tr>";
      }).join("");
      $("medFoot").textContent = d.total + " medicine" + (d.total === 1 ? "" : "s") + " in your catalogue";
    });
  }

  function saveMedicine() {
    var name = $("medName").value.trim();
    if (!name) { toast("Enter the medicine name.", true); return; }

    api("/orders/medicines/save/", {
      method: "POST",
      body: JSON.stringify({
        name: name,
        company: $("medCompany").value.trim(),
        unit: $("medUnit").value,
        available_quantity: parseInt($("medQty").value, 10) || 0,
        unit_price_bdt: $("medPrice").value || "0"
      })
    }).then(function (d) {
      toast(d.medicine.name + (d.created ? " added" : " updated"));
      MediNotify.refresh();
      $("medName").value = "";
      $("medCompany").value = "";
      return loadMedicines();
    }).catch(function (e) { toast(e.message, true); });
  }

  /* ------------------------------- routing ----------------------------- */

  function setView(name) {
    document.querySelectorAll(".view").forEach(function (v) {
      v.classList.toggle("is-active", v.dataset.view === name);
    });
    document.querySelectorAll("#nav .nav-item").forEach(function (b) {
      b.classList.toggle("is-active", b.dataset.view === name);
    });
    document.querySelectorAll("#mobileNav button").forEach(function (b) {
      b.classList.toggle("is-active", b.dataset.view === name);
    });
    $("scrollArea").scrollTop = 0;
  }

  /* -------------------------------- wiring ----------------------------- */

  function wire() {
    document.querySelectorAll("#nav .nav-item, #mobileNav button").forEach(function (b) {
      b.addEventListener("click", function () { setView(b.dataset.view); });
    });

    document.querySelectorAll("#reqChips .chip").forEach(function (chip) {
      chip.addEventListener("click", function () {
        state.reqStatus = chip.dataset.status;
        document.querySelectorAll("#reqChips .chip").forEach(function (c) {
          c.classList.toggle("is-active", c === chip);
        });
        paintRequests();
      });
    });

    var timer;
    $("searchInput").addEventListener("input", function (e) {
      clearTimeout(timer);
      var value = e.target.value.trim();
      timer = setTimeout(function () {
        state.query = value;
        paintRequests();
        paintDeliveries();
      }, 200);
    });

    // one handler covers Accept, Reject and both delivery steps
    document.addEventListener("click", function (e) {
      var btn = e.target.closest && e.target.closest("[data-act]");
      if (!btn) return;
      changeStatus(btn.getAttribute("data-id"), btn.getAttribute("data-act"));
    });

    $("medSave").addEventListener("click", saveMedicine);
    $("logoutBtn").addEventListener("click", MediAuth.logout);
  }

  /* --------------------------------- boot ------------------------------ */

  function boot() {
    // Section 9: only a signed-in distributor account may open this panel.
    var me = MediAuth.guard("distributor");
    if (!me) return;

    var initials = (me.org_name || me.username).split(/[\s-]+/)
      .filter(Boolean).slice(0, 2).map(function (w) { return w[0]; }).join("").toUpperCase();
    $("userInitials").textContent = initials || "DS";
    $("topAvatar").textContent = initials || "DS";
    $("userOrg").textContent = me.org_name;
    $("userName").textContent = me.username + " \u00B7 Distributor";
    $("greetingText").textContent = me.org_name;

    wire();
    MediNotify.mount({ onNavigate: setView });

    Promise.all([loadOrders(), loadMedicines()])
      .catch(function (e) { toast(e.message, true); });
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
