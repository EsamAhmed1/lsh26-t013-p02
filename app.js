/* =========================================================================
   MediShelf - frontend logic
   -------------------------------------------------------------------------
   IMPORTANT: this file never calculates days_left or decides which group an
   item belongs to. Those come from the server, computed against the CASE's
   reference date. The browser clock is deliberately not trusted.
   ========================================================================= */

(function () {
  "use strict";

  // Auth-aware API helper (see auth.js). It attaches the login token and
  // sends the user back to the login page if the token stops working.
  var api = MediAuth.api;

  var state = {
    caseId: null,
    refDate: null,
    dashboard: null,
    group: "all",
    query: "",
    sort: "soonest",
    view: "dashboard",
    pending: null,          // item awaiting return confirmation
    itemsById: {},          // cache so the Return button needs no extra fetch
    catalogue: [],          // distributors + their medicines
    orderStatus: "",        // active filter on the My Orders table
    pendingOrder: null      // order awaiting Add to Inventory
  };

  /* ------------------------------ helpers ------------------------------ */

  var $ = function (id) { return document.getElementById(id); };

  // "21218.90" -> "৳ 21,218.90"  (paisa dropped when they are .00)
  function taka(str) {
    var n = Number(str);
    var whole = Math.trunc(n);
    var paisa = Math.round((n - whole) * 100);
    var s = whole.toLocaleString("en-US");
    if (paisa) s += "." + String(paisa).padStart(2, "0");
    return "\u09F3 " + s;
  }

  function daysLabel(d) {
    if (d < 0) return Math.abs(d) + (Math.abs(d) === 1 ? " day ago" : " days ago");
    if (d === 0) return "Today";
    return d + (d === 1 ? " day" : " days");
  }

  var TAG_CLASS = {
    expired: "tag-expired", soon30: "tag-soon",
    within90: "tag-w90", safe: "tag-safe"
  };

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function toast(message, isError) {
    var el = $("toast");
    el.textContent = message;
    el.className = isError ? "toast err" : "toast";
    el.hidden = false;
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.hidden = true; }, 3200);
  }

  /* Animate a taka figure from its old value down to the new one. */
  function animateMoney(el, fromStr, toStr) {
    var from = Number(fromStr), to = Number(toStr);
    if (!isFinite(from) || from === to) { el.textContent = taka(toStr); return; }

    el.classList.add("is-dropping");
    var start = performance.now(), dur = 700;

    (function step(now) {
      var p = Math.min((now - start) / dur, 1);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = taka(String(from + (to - from) * eased));
      if (p < 1) requestAnimationFrame(step);
      else {
        el.textContent = taka(toStr);
        setTimeout(function () { el.classList.remove("is-dropping"); }, 120);
      }
    })(start);
  }

  /* ---------------------------- dashboard ------------------------------ */

  function paintDashboard(d, animate) {
    var prev = state.dashboard;
    state.dashboard = d;
    state.refDate = d.reference_date;

    var c = d.counts, v = d.values;

    $("cntExpired").textContent = c.expired;
    $("cntSoon").textContent    = c.soon30;
    $("cnt90").textContent      = c.within90;
    $("cntSafe").textContent    = c.safe;

    // Requirement 4 - the two headline taka figures.
    if (animate && prev) {
      animateMoney($("expiredValue"), prev.values.expired_value_bdt, v.expired_value_bdt);
      animateMoney($("soonValue"),    prev.values.soon30_value_bdt,  v.soon30_value_bdt);
    } else {
      $("expiredValue").textContent = taka(v.expired_value_bdt);
      $("soonValue").textContent    = taka(v.soon30_value_bdt);
    }

    $("expiredSub").textContent = v.expired_item_count + " items \u00B7 purchase value";
    $("soonSub").textContent    = v.soon30_item_count + " items \u00B7 still returnable";

    $("alertExpiredValue").textContent = taka(v.expired_value_bdt);
    $("alertSoonValue").textContent    = taka(v.soon30_value_bdt);
    $("alertExpiredSub").textContent   = v.expired_item_count + " items";
    $("alertSoonSub").textContent      = v.soon30_item_count + " items";

    // proportion bar
    var total = d.active_total || 1;
    var bar = $("propBar").children;
    bar[0].style.width = (c.expired  / total * 100) + "%";
    bar[1].style.width = (c.soon30   / total * 100) + "%";
    bar[2].style.width = (c.within90 / total * 100) + "%";
    bar[3].style.width = (c.safe     / total * 100) + "%";

    // the sum check: proves the four groups are mutually exclusive
    $("sumCheck").textContent =
      c.expired + " + " + c.soon30 + " + " + c.within90 + " + " + c.safe +
      " = " + d.counts_sum + " active items" +
      (d.counts_sum === d.active_total ? " \u2713" : "  \u2717 MISMATCH");

    $("heroLine").textContent =
      c.expired + " items already expired \u00B7 " + c.soon30 + " expiring within 30 days";

    $("topbarSub").textContent =
      d.case_id + " \u00B7 reference date " + d.reference_date +
      " \u00B7 " + d.active_total + " active \u00B7 " + d.returned_total + " returned";

    $("sidebarRefDate").textContent = d.reference_date;

    $("navAlertBadge").textContent = c.expired + c.soon30;

    paintReports(d);
  }

  function paintReports(d) {
    var c = d.counts, v = d.values;
    var matched = d.counts_sum === d.active_total;
    var cells = [
      ["Case", d.case_id], ["Reference date", d.reference_date],
      ["Active items", d.active_total], ["Returned items", d.returned_total],
      ["Expired", c.expired], ["Within 30 days", c.soon30],
      ["Within 90 days", c.within90], ["Safe", c.safe],
      ["Expired value", taka(v.expired_value_bdt)],
      ["Expiring soon value (0-30)", taka(v.soon30_value_bdt)]
    ];
    var html = cells.map(function (x) {
      return '<div class="report-cell"><span>' + esc(x[0]) + "</span><b>" + esc(x[1]) + "</b></div>";
    }).join("");
    html += '<div class="report-cell ' + (matched ? "ok" : "bad") +
            '"><span>Counts sum = active</span><b>' +
            (matched ? "\u2713 " + d.counts_sum : "\u2717 mismatch") + "</b></div>";
    $("reportGrid").innerHTML = html;
  }

  /* ------------------------------ tables ------------------------------- */

  function rowHTML(it, opts) {
    opts = opts || {};
    var tag = '<span class="tag ' + TAG_CLASS[it.group] + '">' + esc(daysLabel(it.days_left)) + "</span>";
    var btnClass = it.group === "expired" ? "btn-return danger" : "btn-return";
    var action = '<button class="' + btnClass + '" data-return="' + esc(it.item_id) + '">Return to Dist.</button>';

    var cells = [
      '<td><div class="med">' + esc(it.name) + '</div><div class="med-sub">' + esc(it.company) + " \u00B7 " + esc(it.item_id) + "</div></td>",
      '<td><span class="batch">' + esc(it.batch) + "</span></td>",
      '<td class="num">' + it.quantity + "</td>"
    ];
    if (!opts.hideUnit) cells.push('<td class="num">' + taka(it.unit_price_bdt) + "</td>");
    cells.push('<td class="num money">' + taka(it.value_at_risk) + "</td>");
    cells.push('<td><span class="date">' + esc(it.expiry) + "</span></td>");
    cells.push("<td>" + tag + "</td>");
    cells.push("<td>" + action + "</td>");

    return '<tr class="row-' + it.group + '">' + cells.join("") + "</tr>";
  }

  function emptyRow(cols, text) {
    return '<tr><td colspan="' + cols + '"><p class="empty">' + esc(text) + "</p></td></tr>";
  }

  function loadStock() {
    var q = "?case=" + encodeURIComponent(state.caseId) +
            "&group=" + encodeURIComponent(state.group) +
            "&sort=" + encodeURIComponent(state.sort) +
            (state.query ? "&q=" + encodeURIComponent(state.query) : "");

    return api("/medicines/" + q).then(function (d) {
      d.items.forEach(function (it) { state.itemsById[it.item_id] = it; });
      var rows = d.items.length
        ? d.items.map(function (it) { return rowHTML(it); }).join("")
        : emptyRow(8, "No items match this filter.");
      $("stockBody").innerHTML = rows;
      $("stockBody2").innerHTML = rows;

      var foot = "Showing " + d.items.length + " item" + (d.items.length === 1 ? "" : "s") +
                 " \u00B7 " + d.case_id + " \u00B7 reference date " + d.reference_date;
      $("stockFoot").textContent = foot;
      $("stockFoot2").textContent = foot;
    });
  }

  function loadAlerts() {
    var base = "?case=" + encodeURIComponent(state.caseId) + "&sort=soonest" +
               (state.query ? "&q=" + encodeURIComponent(state.query) : "");

    return Promise.all([
      api("/medicines/" + base + "&group=expired"),
      api("/medicines/" + base + "&group=soon30")
    ]).then(function (res) {
      var items = res[0].items.concat(res[1].items);
      items.forEach(function (it) { state.itemsById[it.item_id] = it; });
      $("alertBody").innerHTML = items.length
        ? items.map(function (it) { return rowHTML(it, { hideUnit: true }); }).join("")
        : emptyRow(7, "Nothing expired and nothing expiring within 30 days.");
      $("alertFoot").textContent = items.length + " item(s) needing action";
    });
  }

  function loadReturned() {
    var q = "?case=" + encodeURIComponent(state.caseId) +
            (state.query ? "&q=" + encodeURIComponent(state.query) : "");

    return api("/returned/" + q).then(function (d) {
      if (!d.items.length) {
        $("returnedBody").innerHTML = emptyRow(5, "No items returned yet.");
        $("returnedFoot").textContent = "0 returned items";
        return;
      }
      $("returnedBody").innerHTML = d.items.map(function (it) {
        var when = it.returned_at ? it.returned_at.slice(0, 10) : "\u2014";
        return "<tr>" +
          '<td><div class="med">' + esc(it.name) + "</div>" +
          '<div class="med-sub">' + esc(it.company) + " \u00B7 " + esc(it.item_id) + "</div>" +
          '<div class="ret-stamp"><span class="tag tag-returned">Returned</span>' +
          '<span class="ret-date">' + esc(when) + "</span></div></td>" +
          '<td><span class="batch">' + esc(it.batch) + '</span><div class="med-sub">Exp: ' + esc(it.expiry) + "</div></td>" +
          '<td class="num">' + it.quantity + "</td>" +
          '<td class="num money">' + taka(it.value_at_risk) + "</td>" +
          "<td>" + esc(it.reason) + "</td>" +
        "</tr>";
      }).join("");
      $("returnedFoot").textContent = "Showing " + d.items.length +
        " returned item" + (d.items.length === 1 ? "" : "s") +
        " \u00B7 excluded from all active counts and value totals";
    });
  }

  function loadCompanyReport() {
    return api("/medicines/?case=" + encodeURIComponent(state.caseId)).then(function (d) {
      var by = {};
      d.items.forEach(function (it) {
        var row = by[it.company] || (by[it.company] = { expired: 0, soon: 0, n: 0 });
        row.n++;
        if (it.group === "expired") row.expired += Number(it.value_at_risk);
        if (it.group === "soon30")  row.soon    += Number(it.value_at_risk);
      });
      var names = Object.keys(by).sort(function (a, b) {
        return (by[b].expired + by[b].soon) - (by[a].expired + by[a].soon);
      });
      $("reportBody").innerHTML = names.map(function (n) {
        return "<tr><td><b>" + esc(n) + "</b></td>" +
          '<td class="num money">' + taka(String(by[n].expired)) + "</td>" +
          '<td class="num money">' + taka(String(by[n].soon)) + "</td>" +
          '<td class="num">' + by[n].n + "</td></tr>";
      }).join("");
    });
  }

  function refreshAll(animate) {
    return api("/dashboard/?case=" + encodeURIComponent(state.caseId))
      .then(function (d) { paintDashboard(d, animate); })
      .then(loadStock)
      .then(loadAlerts)
      .then(loadReturned)
      .then(loadCompanyReport)
      .then(loadOrders)
      .catch(function (e) { toast(e.message, true); });
  }

  /* ------------------------------ modal -------------------------------- */

  function openModal(item) {
    state.pending = item;
    $("modalMed").textContent = item.name;
    $("modalMeta").textContent =
      "Batch " + item.batch + "  \u00B7  " + item.quantity + " units  \u00B7  " +
      taka(item.unit_price_bdt) + " each";
    $("modalAmount").textContent = taka(item.value_at_risk);
    $("modalBack").hidden = false;
  }

  function closeModal() {
    state.pending = null;
    $("modalBack").hidden = true;
  }

  function confirmReturn() {
    var item = state.pending;
    if (!item) return;
    closeModal();

    api("/return/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ case: state.caseId, item_id: item.item_id })
    }).then(function (d) {
      // The response carries the refreshed dashboard, so the numbers drop
      // in the same round trip as the return itself.
      paintDashboard(d.dashboard, true);
      toast(item.name + " returned \u00B7 " + taka(d.value_removed_bdt) + " left the active totals");
      MediNotify.refresh();
      return Promise.all([loadStock(), loadAlerts(), loadReturned(), loadCompanyReport()]);
    }).catch(function (e) { toast(e.message, true); });
  }


  /* ============================ ORDERING ============================== */

  var ORDER_STEPS = ["pending", "accepted", "out_for_delivery", "delivered"];

  function trackerHTML(o) {
    if (o.status === "rejected") {
      return '<div class="tracker"><i class="rejected"></i><i></i><i></i><i></i></div>' +
             '<div class="tracker-labels"><span>Rejected</span></div>';
    }
    var reached = ORDER_STEPS.indexOf(o.status);
    var bars = ORDER_STEPS.map(function (_, i) {
      return '<i class="' + (i <= reached ? "done" : "") + '"></i>';
    }).join("");
    return '<div class="tracker">' + bars + "</div>" +
           '<div class="tracker-labels"><span>Placed</span><span>Accepted</span>' +
           "<span>Shipped</span><span>Delivered</span></div>";
  }

  function loadCatalogue() {
    return api("/orders/catalogue/").then(function (d) {
      state.catalogue = d.distributors;
      var sel = $("ordDistributor");

      if (!d.distributors.length) {
        sel.innerHTML = "<option>No distributors available</option>";
        $("ordMedicine").innerHTML = "";
        $("ordHint").textContent = "No distributor stock is available right now.";
        return;
      }

      sel.innerHTML = d.distributors.map(function (x) {
        return '<option value="' + x.id + '">' + esc(x.name) + "</option>";
      }).join("");
      fillMedicines();
    });
  }

  function fillMedicines() {
    var id = Number($("ordDistributor").value);
    var dist = state.catalogue.filter(function (x) { return x.id === id; })[0];
    var sel = $("ordMedicine");
    if (!dist) { sel.innerHTML = ""; return; }

    sel.innerHTML = dist.medicines.map(function (m) {
      return '<option value="' + m.id + '">' + esc(m.name) +
             "  \u00B7  " + m.available_quantity + " " + esc(m.unit.toLowerCase()) +
             "  \u00B7  " + taka(m.unit_price_bdt) + "</option>";
    }).join("");
    updateOrderHint();
  }

  function selectedMedicine() {
    var did = Number($("ordDistributor").value);
    var mid = Number($("ordMedicine").value);
    var dist = state.catalogue.filter(function (x) { return x.id === did; })[0];
    if (!dist) return null;
    return dist.medicines.filter(function (m) { return m.id === mid; })[0] || null;
  }

  function updateOrderHint() {
    var m = selectedMedicine();
    if (!m) { $("ordHint").textContent = "\u2014"; return; }
    var qty = Number($("ordQty").value) || 0;
    var cost = qty * Number(m.unit_price_bdt);
    $("ordHint").textContent =
      m.available_quantity + " " + m.unit.toLowerCase() + " available \u00B7 " +
      "order cost " + taka(String(cost));
  }

  function placeOrder() {
    var m = selectedMedicine();
    if (!m) { toast("Pick a medicine first.", true); return; }
    var qty = parseInt($("ordQty").value, 10);
    if (!qty || qty < 1) { toast("Enter a quantity of 1 or more.", true); return; }

    api("/orders/place/", {
      method: "POST",
      body: JSON.stringify({ medicine_id: m.id, quantity: qty })
    }).then(function (d) {
      toast("Order placed for " + d.order.medicine_name + " \u00D7 " + d.order.quantity);
      MediNotify.refresh();
      return Promise.all([loadOrders(), loadCatalogue()]);
    }).catch(function (e) { toast(e.message, true); });
  }

  function loadOrders() {
    var q = state.orderStatus ? "?status=" + encodeURIComponent(state.orderStatus) : "";
    return api("/orders/mine/" + q).then(function (d) {
      var c = d.counts;
      $("ordStats").innerHTML = [
        ["Pending", c.pending], ["Accepted", c.accepted],
        ["Out for Delivery", c.out_for_delivery], ["Delivered", c.delivered],
        ["Rejected", c.rejected]
      ].map(function (x) {
        return '<div class="stat-cell"><b>' + x[1] + "</b><span class=\"tag tag-" +
               x[0].toLowerCase().replace(/ /g, "_") + '">' + esc(x[0]) + "</span></div>";
      }).join("");

      $("navOrderBadge").textContent = c.pending + c.accepted + c.out_for_delivery;

      if (!d.orders.length) {
        $("ordBody").innerHTML = emptyRow(6, "No orders yet. Place one above.");
        $("ordFoot").textContent = "0 orders";
        return;
      }

      $("ordBody").innerHTML = d.orders.map(function (o) {
        // Delivery progress only appears once the distributor has accepted.
        var statusCell = '<span class="tag tag-' + o.status + '">' +
                         esc(o.status_label) + "</span>" +
                         (o.show_delivery ? trackerHTML(o) : "");

        var action = "\u2014";
        if (o.can_add_to_inventory) {
          action = '<button class="btn-mini good" data-addinv="' + o.id + '">Add to Inventory</button>';
        } else if (o.added_to_inventory) {
          action = '<span class="tag tag-safe">In Inventory</span>';
        } else if (o.status === "pending") {
          action = '<span class="med-sub">Awaiting distributor</span>';
        }

        return "<tr>" +
          '<td><div class="med">' + esc(o.medicine_name) + "</div>" +
          '<div class="med-sub">Order #' + o.id + "</div></td>" +
          "<td>" + esc(o.distributor_name) + "</td>" +
          '<td class="num">' + o.quantity + " " + esc(o.unit.toLowerCase()) + "</td>" +
          '<td><span class="date">' + esc(o.ordered_at.slice(0, 10)) + "</span></td>" +
          '<td style="min-width:200px">' + statusCell + "</td>" +
          "<td>" + action + "</td>" +
        "</tr>";
      }).join("");

      $("ordFoot").textContent = d.orders.length + " order" +
        (d.orders.length === 1 ? "" : "s") + " shown";
    });
  }

  /* -------------------- Add to Inventory (step 7) --------------------- */

  function openInventoryModal(order) {
    state.pendingOrder = order;
    $("invName").value = order.medicine_name;
    $("invBatch").value = "";
    $("invExpiry").value = "";
    $("invQty").value = order.quantity;
    $("invUnit").value = order.unit || "Units";
    $("invError").hidden = true;
    $("invBack").hidden = false;
  }

  function closeInventoryModal() {
    state.pendingOrder = null;
    $("invBack").hidden = true;
  }

  function submitInventory() {
    var o = state.pendingOrder;
    if (!o) return;

    api("/orders/add-to-inventory/", {
      method: "POST",
      body: JSON.stringify({
        order_id: o.id,
        name: $("invName").value.trim(),
        batch: $("invBatch").value.trim(),
        expiry: $("invExpiry").value,
        quantity: parseInt($("invQty").value, 10),
        unit: $("invUnit").value
      })
    }).then(function (d) {
      closeInventoryModal();
      toast(d.item.name + " added \u00B7 batch " + d.item.batch +
            " \u00B7 " + d.item.days_left + " days left");
      MediNotify.refresh();
      // It now flows through the existing expiry system with no extra code.
      return refreshAll(false);
    }).catch(function (e) {
      var el = $("invError");
      el.textContent = e.message;
      el.hidden = false;
    });
  }

  /* ------------------------------ routing ------------------------------ */

  function setView(name) {
    state.view = name;
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

  function setGroup(group) {
    state.group = group;
    document.querySelectorAll(".chip[data-group]").forEach(function (c) {
      c.classList.toggle("is-active", c.dataset.group === group);
    });
    loadStock();
  }

  /* ------------------------------- wiring ------------------------------ */

  function wire() {
    document.querySelectorAll("#nav .nav-item, #mobileNav button").forEach(function (b) {
      b.addEventListener("click", function () { setView(b.dataset.view); });
    });

    // Only the stock-filter chips. The order-status chips live in #ordChips
    // and are wired separately below - matching them here would send an
    // undefined group to the API.
    document.querySelectorAll(".chip[data-group], .chip[data-nav]").forEach(function (chip) {
      chip.addEventListener("click", function () {
        if (chip.dataset.nav) { setView(chip.dataset.nav); return; }
        setGroup(chip.dataset.group);
      });
    });

    document.querySelectorAll(".health-cell").forEach(function (cell) {
      cell.addEventListener("click", function () {
        setGroup(cell.dataset.group);
        $("scrollArea").scrollTo({ top: 99999, behavior: "smooth" });
      });
    });

    $("heroBtn").addEventListener("click", function () { setView("alerts"); });

    // ---- ordering
    $("ordDistributor").addEventListener("change", fillMedicines);
    $("ordMedicine").addEventListener("change", updateOrderHint);
    $("ordQty").addEventListener("input", updateOrderHint);
    $("ordSubmit").addEventListener("click", placeOrder);

    document.querySelectorAll("#ordChips .chip").forEach(function (chip) {
      chip.addEventListener("click", function () {
        state.orderStatus = chip.dataset.status;
        document.querySelectorAll("#ordChips .chip").forEach(function (c) {
          c.classList.toggle("is-active", c === chip);
        });
        loadOrders();
      });
    });

    document.addEventListener("click", function (e) {
      var btn = e.target.closest && e.target.closest("[data-addinv]");
      if (!btn) return;
      api("/orders/mine/").then(function (d) {
        var o = d.orders.filter(function (x) {
          return String(x.id) === btn.getAttribute("data-addinv");
        })[0];
        if (o) openInventoryModal(o);
      }).catch(function (err) { toast(err.message, true); });
    });

    $("invCancel").addEventListener("click", closeInventoryModal);
    $("invConfirm").addEventListener("click", submitInventory);
    $("invBack").addEventListener("click", function (e) {
      if (e.target === this) closeInventoryModal();
    });

    $("logoutBtn").addEventListener("click", MediAuth.logout);

    // sort toggle on the Days Left column
    $("sortDays").addEventListener("click", function () {
      state.sort = state.sort === "soonest" ? "furthest" : "soonest";
      this.querySelector(".sort-arrow").classList.toggle("down", state.sort === "furthest");
      loadStock();
    });

    // debounced search
    var timer;
    $("searchInput").addEventListener("input", function (e) {
      clearTimeout(timer);
      var value = e.target.value.trim();
      timer = setTimeout(function () {
        state.query = value;
        loadStock(); loadAlerts(); loadReturned();
      }, 250);
    });

    $("caseSelect").addEventListener("change", function (e) {
      state.caseId = e.target.value;
      state.itemsById = {};
      refreshAll(false);
    });

    $("resetBtn").addEventListener("click", function () {
      if (!confirm("Restore " + state.caseId + " to its loaded state?\n\n" +
                   "Every item you returned during the demo becomes active again.")) return;
      api("/reset/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ case: state.caseId })
      }).then(function () {
        toast(state.caseId + " restored to its loaded state");
        return refreshAll(false);
      }).catch(function (e) { toast(e.message, true); });
    });

    // one delegated handler covers every table's Return button
    document.addEventListener("click", function (e) {
      var btn = e.target.closest && e.target.closest("[data-return]");
      if (!btn) return;
      var key = btn.getAttribute("data-return");

      var cached = state.itemsById[key];
      if (cached) { openModal(cached); return; }

      // Fallback only if the row somehow is not in the cache.
      api("/medicines/?case=" + encodeURIComponent(state.caseId) + "&group=all")
        .then(function (d) {
          var item = d.items.filter(function (x) { return x.item_id === key; })[0];
          if (item) openModal(item);
          else toast("Could not load that item.", true);
        })
        .catch(function (err) { toast(err.message, true); });
    });

    $("modalCancel").addEventListener("click", closeModal);
    $("modalConfirm").addEventListener("click", confirmReturn);
    $("modalBack").addEventListener("click", function (e) {
      if (e.target === this) closeModal();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      if (!$("modalBack").hidden) closeModal();
      if (!$("invBack").hidden) closeInventoryModal();
    });

    // greeting follows the real wall clock; expiry maths never does
    var h = new Date().getHours();
    var hello = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
    var me = MediAuth.user();
    $("greetingText").textContent = hello + ", " + (me ? me.username : "there");
  }

  /* ------------------------------- boot -------------------------------- */

  function boot() {
    // Section 9: only a signed-in pharmacy account may open this panel.
    var me = MediAuth.guard("pharmacy");
    if (!me) return;

    var initials = (me.org_name || me.username).split(/[\s-]+/)
      .filter(Boolean).slice(0, 2).map(function (w) { return w[0]; }).join("").toUpperCase();
    $("userInitials").textContent = initials || "PH";
    $("userOrg").textContent = me.org_name;
    $("userName").textContent = me.username + " \u00B7 Pharmacy";
    $("greetingText").textContent = "Good morning, " + me.username;

    wire();

    // Bell: clicking a notification jumps to the matching section.
    MediNotify.mount({ onNavigate: setView });

    loadCatalogue().catch(function (e) { toast(e.message, true); });

    api("/cases/").then(function (d) {
      var sel = $("caseSelect");
      sel.innerHTML = d.cases.map(function (c) {
        return '<option value="' + esc(c.case_id) + '">' +
               esc(c.case_id) + "  \u00B7  " + esc(c.today) + "</option>";
      }).join("");
      state.caseId = d.default || d.cases[0].case_id;
      sel.value = state.caseId;
      return refreshAll(false);
    }).catch(function (e) {
      toast("Could not load demo data. (" + e.message + ")", true);
    });
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
