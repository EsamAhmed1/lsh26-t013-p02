/* =========================================================================
   MediShelf - in-browser mock backend.
   -------------------------------------------------------------------------
   This file replaces the old Django REST API with a pure front-end
   implementation. It stores all "database" state in localStorage (shared
   by every tab on this origin) so the Pharmacy and Distributor panels can
   be used together in the same browser session, exactly like the old
   client/server split did.

   auth.js calls window.MediMock.request(path, options) instead of fetch().
   Every function below mirrors the exact response shape (and the exact
   business rules) of the old backend/*.py files, so app.js and
   distributor.js needed no changes at all.
   ========================================================================= */

window.MediMock = (function () {
  "use strict";

  var DB_KEY = "medishelf_mock_db_v1";

  /* --------------------------------------------------------------------
     Seed data - mirrors backend/accounts/management/commands/seed_demo.py
     -------------------------------------------------------------------- */

  var PHARMACIES_SEED = [
    { username: "pharmacy", password: "pharma123", name: "Lazz Pharma - Dhanmondi", case_id: "PUB-01" },
    { username: "pharmacy2", password: "pharma123", name: "Tamanna Pharmacy - Mirpur", case_id: "PUB-02" }
  ];

  var DISTRIBUTORS_SEED = [
    { username: "distributor", password: "dist123", name: "Square Distribution Ltd" },
    { username: "distributor2", password: "dist123", name: "Beximco Supply House" }
  ];

  var CATALOGUE_SEED = {
    "Square Distribution Ltd": [
      ["Napa 500", "Beximco", "Tablets", 5000, "1.20"],
      ["Seclo 20", "Square", "Capsules", 3200, "7.00"],
      ["Maxpro 20", "Square", "Capsules", 2800, "8.00"],
      ["Fexo 120", "Square", "Tablets", 1500, "9.00"],
      ["Ace 500", "Square", "Tablets", 4000, "1.50"],
      ["Sergel 20", "Healthcare", "Capsules", 2600, "7.50"],
      ["Monas 10", "Square", "Tablets", 900, "16.00"]
    ],
    "Beximco Supply House": [
      ["Napa Extra", "Beximco", "Tablets", 4200, "2.00"],
      ["Alatrol 10", "Eskayef", "Tablets", 2500, "3.00"],
      ["Losectil 20", "Beximco", "Capsules", 1800, "8.50"],
      ["Amoxicillin 500", "Incepta", "Capsules", 1200, "12.00"],
      ["Ceevit", "Square", "Tablets", 3000, "2.50"],
      ["Flagyl 400", "Opsonin", "Tablets", 1600, "4.50"],
      ["Orsaline N", "Renata", "Sachets", 5000, "6.00"]
    ]
  };

  var DEFAULT_CASE = "PUB-01";

  /* ------------------------------ grouping ------------------------------
     Exact port of backend/inventory/grouping.py. Nothing else in this file
     is allowed to re-implement these boundaries.
     ---------------------------------------------------------------------- */

  var EXPIRED = "expired", SOON30 = "soon30", WITHIN90 = "within90", SAFE = "safe";
  var GROUPS = [EXPIRED, SOON30, WITHIN90, SAFE];
  var GROUP_LABELS = {
    expired: "Expired", soon30: "Within 30 Days",
    within90: "Within 90 Days", safe: "Safe"
  };

  function toUTCDate(iso) {
    // iso like "2026-08-16" - parsed as UTC midnight so day maths never
    // drifts with the browser's local timezone.
    var parts = iso.split("-").map(Number);
    return Date.UTC(parts[0], parts[1] - 1, parts[2]);
  }

  function daysLeft(expiryIso, referenceIso) {
    var ms = toUTCDate(expiryIso) - toUTCDate(referenceIso);
    return Math.round(ms / 86400000);
  }

  function groupFor(days) {
    if (days < 0) return EXPIRED;
    if (days <= 30) return SOON30;
    if (days <= 90) return WITHIN90;
    return SAFE;
  }

  function classify(expiryIso, referenceIso) {
    var d = daysLeft(expiryIso, referenceIso);
    return { days: d, group: groupFor(d) };
  }

  function valueAtRisk(quantity, unitPriceStr) {
    return round2(Number(quantity) * Number(unitPriceStr));
  }

  function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

  function money(n) { return Number(n).toFixed(2); }

  /* -------------------------------- errors ------------------------------ */

  function ApiError(status, code, message) {
    this.status = status;
    this.code = code;
    this.message = message;
  }
  ApiError.prototype = Object.create(Error.prototype);

  function fail(status, code, message) { throw new ApiError(status, code, message); }

  /* --------------------------------- ids --------------------------------- */

  function nextId(db, counterName) {
    db.meta[counterName] = (db.meta[counterName] || 0) + 1;
    return db.meta[counterName];
  }

  /* ------------------------------ persistence ---------------------------- */

  function seedDatabase() {
    var db = {
      meta: { nextMedicineId: 0, nextOrderId: 0, nextPharmacyId: 0, nextDistributorId: 0, nextDistMedId: 0 },
      users: {},
      pharmacies: {},
      distributors: {},
      distributorMedicines: {},
      cases: {},
      medicines: {},
      orders: {},
      tokens: {}
    };

    var rawCases = window.MEDISHELF_CASES_RAW || [];
    rawCases.forEach(function (raw) {
      db.cases[raw.case_id] = { case_id: raw.case_id, today: raw.today };
      var returnedIds = {};
      (raw.mark_returned || []).forEach(function (id) { returnedIds[id] = true; });

      raw.items.forEach(function (item) {
        var id = nextId(db, "nextMedicineId");
        var preReturned = !!returnedIds[item.id];
        db.medicines[id] = {
          id: id,
          case_id: raw.case_id,
          item_id: item.id,
          name: item.name,
          company: item.company,
          batch: item.batch,
          quantity: Number(item.quantity),
          unit_price_bdt: Number(item.unit_price_bdt).toFixed(2),
          expiry: item.expiry,
          unit: "Units",
          status: preReturned ? "returned" : "active",
          returned_at: preReturned ? new Date().toISOString() : null,
          initially_returned: preReturned,
          added_by_pharmacy: false,
          added_at: null
        };
      });
    });

    PHARMACIES_SEED.forEach(function (p) {
      var id = nextId(db, "nextPharmacyId");
      db.pharmacies[id] = { id: id, name: p.name, address: "", active_case_id: p.case_id };
      db.users[p.username] = {
        password: p.password, role: "pharmacy", org_name: p.name,
        pharmacy_id: id, distributor_id: null
      };
    });

    DISTRIBUTORS_SEED.forEach(function (d) {
      var id = nextId(db, "nextDistributorId");
      db.distributors[id] = { id: id, name: d.name, address: "" };
      db.users[d.username] = {
        password: d.password, role: "distributor", org_name: d.name,
        pharmacy_id: null, distributor_id: id
      };

      (CATALOGUE_SEED[d.name] || []).forEach(function (row) {
        var mid = nextId(db, "nextDistMedId");
        db.distributorMedicines[mid] = {
          id: mid, distributor_id: id,
          name: row[0], company: row[1], unit: row[2],
          available_quantity: row[3], unit_price_bdt: Number(row[4]).toFixed(2),
          is_active: true
        };
      });
    });

    saveDb(db);
    return db;
  }

  function loadDb() {
    var raw = localStorage.getItem(DB_KEY);
    if (!raw) return seedDatabase();
    try {
      return JSON.parse(raw);
    } catch (e) {
      return seedDatabase();
    }
  }

  function saveDb(db) {
    localStorage.setItem(DB_KEY, JSON.stringify(db));
  }

  /* ------------------------------ small helpers -------------------------- */

  function values(obj) { return Object.keys(obj).map(function (k) { return obj[k]; }); }

  function caseItems(db, caseId, status) {
    return values(db.medicines).filter(function (m) {
      return m.case_id === caseId && (!status || m.status === status);
    });
  }

  function describeUser(username, u) {
    return {
      username: username,
      full_name: username,
      role: u.role,
      org_name: u.org_name,
      pharmacy_id: u.pharmacy_id,
      distributor_id: u.distributor_id,
      panel: u.role === "distributor" ? "distributor.html" : "index.html"
    };
  }

  function serializeMedicine(m, refDate) {
    var c = classify(m.expiry, refDate);
    return {
      id: m.id,
      item_id: m.item_id,
      name: m.name,
      company: m.company,
      batch: m.batch,
      quantity: m.quantity,
      unit: m.unit || "Units",
      added_by_pharmacy: m.added_by_pharmacy,
      unit_price_bdt: money(m.unit_price_bdt),
      expiry: m.expiry,
      days_left: c.days,
      group: c.group,
      group_label: GROUP_LABELS[c.group],
      value_at_risk: money(valueAtRisk(m.quantity, m.unit_price_bdt)),
      status: m.status,
      returned_at: m.returned_at
    };
  }

  function buildDashboard(db, caseObj) {
    var counts = { expired: 0, soon30: 0, within90: 0, safe: 0 };
    var vals = { expired: 0, soon30: 0 };
    var active = caseItems(db, caseObj.case_id, "active");

    active.forEach(function (m) {
      var c = classify(m.expiry, caseObj.today);
      counts[c.group]++;
      if (c.group === EXPIRED) vals.expired = round2(vals.expired + valueAtRisk(m.quantity, m.unit_price_bdt));
      if (c.group === SOON30) vals.soon30 = round2(vals.soon30 + valueAtRisk(m.quantity, m.unit_price_bdt));
    });

    var countsSum = counts.expired + counts.soon30 + counts.within90 + counts.safe;
    var returnedTotal = caseItems(db, caseObj.case_id, "returned").length;

    return {
      case_id: caseObj.case_id,
      reference_date: caseObj.today,
      active_total: active.length,
      returned_total: returnedTotal,
      counts_sum: countsSum,
      counts: counts,
      values: {
        expired_value_bdt: money(vals.expired),
        soon30_value_bdt: money(vals.soon30),
        expired_item_count: counts.expired,
        soon30_item_count: counts.soon30
      }
    };
  }

  var ORDER_STATUS_LABELS = {
    pending: "Pending", accepted: "Accepted", rejected: "Rejected",
    out_for_delivery: "Out for Delivery", delivered: "Delivered"
  };

  var ALLOWED_NEXT = {
    pending: ["accepted", "rejected"],
    accepted: ["out_for_delivery"],
    out_for_delivery: ["delivered"],
    delivered: [],
    rejected: []
  };

  function serializeOrder(db, o, viewer) {
    var pharmacy = db.pharmacies[o.pharmacy_id];
    var distributor = db.distributors[o.distributor_id];
    var data = {
      id: o.id,
      pharmacy_name: pharmacy ? pharmacy.name : "",
      distributor_name: distributor ? distributor.name : "",
      distributor_id: o.distributor_id,
      medicine_name: o.medicine_name,
      quantity: o.quantity,
      unit: o.unit,
      status: o.status,
      status_label: ORDER_STATUS_LABELS[o.status] || o.status,
      note: o.note || "",
      ordered_at: o.ordered_at,
      decided_at: o.decided_at,
      delivered_at: o.delivered_at,
      added_to_inventory: o.added_to_inventory,
      can_add_to_inventory: (o.status === "delivered" && !o.added_to_inventory),
      next_statuses: (ALLOWED_NEXT[o.status] || []).slice().sort()
    };
    if (viewer === "pharmacy") {
      data.show_delivery = ["accepted", "out_for_delivery", "delivered"].indexOf(o.status) > -1;
    }
    return data;
  }

  /* -------------------------------- auth --------------------------------- */

  function currentUser(db, token) {
    var username = db.tokens[token];
    if (!username) return null;
    var u = db.users[username];
    if (!u) return null;
    return { username: username, profile: u };
  }

  function requireLogin(db, token) {
    var me = currentUser(db, token);
    if (!me) fail(401, "not_authenticated", "Please log in.");
    return me;
  }

  function requireRole(db, token, role) {
    var me = requireLogin(db, token);
    if (me.profile.role !== role) {
      fail(403, "forbidden", "This area is for " + role + " accounts only.");
    }
    return me;
  }

  /* ------------------------------- routing -------------------------------- */

  function getCase(db, query, body, pharmacy) {
    var caseId = (body && body.case) || (query && query.get("case"));
    if (!caseId) {
      if (pharmacy && pharmacy.active_case_id) caseId = pharmacy.active_case_id;
      else caseId = DEFAULT_CASE;
    }
    var c = db.cases[caseId];
    if (!c) fail(404, "case_not_found", "No case named '" + caseId + "'.");
    return c;
  }

  function route(method, pathname, query, body, token) {
    var db = loadDb();

    /* ---------------- auth ---------------- */

    if (method === "POST" && pathname === "/auth/login/") {
      var username = (body.username || "").trim();
      var password = body.password || "";
      if (!username || !password) fail(400, "missing_fields", "Enter both a username and a password.");
      var u = db.users[username];
      if (!u || u.password !== password) fail(401, "bad_credentials", "Wrong username or password.");
      var tok = "tok_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
      db.tokens[tok] = username;
      saveDb(db);
      return { token: tok, user: describeUser(username, u) };
    }

    if (method === "POST" && pathname === "/auth/logout/") {
      delete db.tokens[token];
      saveDb(db);
      return { message: "Logged out." };
    }

    /* -------- everything below requires login -------- */

    if (pathname === "/cases/") {
      requireRole(db, token, "pharmacy");
      var list = values(db.cases).map(function (c) {
        return { case_id: c.case_id, today: c.today, item_count: caseItems(db, c.case_id).length };
      }).sort(function (a, b) { return a.case_id < b.case_id ? -1 : 1; });
      return { cases: list, default: DEFAULT_CASE };
    }

    if (pathname === "/dashboard/") {
      var me1 = requireRole(db, token, "pharmacy");
      var pharmacy1 = db.pharmacies[me1.profile.pharmacy_id];
      var case1 = getCase(db, query, null, pharmacy1);
      return buildDashboard(db, case1);
    }

    if (pathname === "/medicines/") {
      var me2 = requireRole(db, token, "pharmacy");
      var pharmacy2 = db.pharmacies[me2.profile.pharmacy_id];
      var case2 = getCase(db, query, null, pharmacy2);

      var group = (query.get("group") || "all").toLowerCase();
      var q = (query.get("q") || "").trim().toLowerCase();
      var sort = (query.get("sort") || "soonest").toLowerCase();

      var rows = caseItems(db, case2.case_id, "active");
      if (q) {
        rows = rows.filter(function (m) {
          return m.name.toLowerCase().indexOf(q) > -1 ||
                 m.batch.toLowerCase().indexOf(q) > -1 ||
                 m.company.toLowerCase().indexOf(q) > -1;
        });
      }
      rows.sort(function (a, b) {
        if (a.expiry === b.expiry) return a.item_id < b.item_id ? -1 : 1;
        if (sort === "furthest") return a.expiry < b.expiry ? 1 : -1;
        return a.expiry < b.expiry ? -1 : 1;
      });

      var serialized = rows.map(function (m) { return serializeMedicine(m, case2.today); });
      if (GROUPS.indexOf(group) > -1) {
        serialized = serialized.filter(function (r) { return r.group === group; });
      } else if (group !== "all" && group !== "active") {
        fail(400, "bad_group", "Unknown group '" + group + "'.");
      }

      return {
        case_id: case2.case_id, reference_date: case2.today,
        group: group, count: serialized.length, items: serialized
      };
    }

    if (pathname === "/returned/") {
      var me3 = requireRole(db, token, "pharmacy");
      var pharmacy3 = db.pharmacies[me3.profile.pharmacy_id];
      var case3 = getCase(db, query, null, pharmacy3);
      var q3 = (query.get("q") || "").trim().toLowerCase();

      var rows3 = caseItems(db, case3.case_id, "returned");
      if (q3) {
        rows3 = rows3.filter(function (m) {
          return m.name.toLowerCase().indexOf(q3) > -1 ||
                 m.batch.toLowerCase().indexOf(q3) > -1 ||
                 m.company.toLowerCase().indexOf(q3) > -1;
        });
      }
      rows3.sort(function (a, b) {
        var ra = a.returned_at || "", rb = b.returned_at || "";
        if (ra === rb) return a.item_id < b.item_id ? -1 : 1;
        return ra < rb ? 1 : -1;
      });

      var serialized3 = rows3.map(function (m) {
        var r = serializeMedicine(m, case3.today);
        r.reason = GROUP_LABELS[r.group];
        return r;
      });

      return { case_id: case3.case_id, count: serialized3.length, items: serialized3 };
    }

    if (method === "POST" && pathname === "/return/") {
      var me4 = requireRole(db, token, "pharmacy");
      var pharmacy4 = db.pharmacies[me4.profile.pharmacy_id];
      var case4 = getCase(db, query, body, pharmacy4);

      var key = body.item_id || body.id;
      if (!key) fail(400, "missing_id", "Provide item_id (e.g. 'M006').");

      var item = caseItems(db, case4.case_id).filter(function (m) {
        return String(m.id) === String(key) || m.item_id === key;
      })[0];
      if (!item) fail(404, "item_not_found", "No item '" + key + "' in " + case4.case_id + ".");
      if (item.status === "returned") {
        fail(409, "already_returned", item.name + " (" + item.batch + ") is already on the returned list.");
      }

      var removed = valueAtRisk(item.quantity, item.unit_price_bdt);
      item.status = "returned";
      item.returned_at = new Date().toISOString();
      saveDb(db);

      return {
        returned_item: serializeMedicine(item, case4.today),
        value_removed_bdt: money(removed),
        dashboard: buildDashboard(db, case4)
      };
    }

    if (method === "POST" && pathname === "/reset/") {
      var me5 = requireRole(db, token, "pharmacy");
      var pharmacy5 = db.pharmacies[me5.profile.pharmacy_id];
      var case5 = getCase(db, query, body, pharmacy5);

      values(db.medicines).forEach(function (m) {
        if (m.case_id !== case5.case_id) return;
        if (m.added_by_pharmacy) { delete db.medicines[m.id]; return; }
        if (m.initially_returned) { m.status = "returned"; m.returned_at = new Date().toISOString(); }
        else { m.status = "active"; m.returned_at = null; }
      });
      saveDb(db);

      return {
        message: case5.case_id + " restored to its loaded state.",
        dashboard: buildDashboard(db, case5)
      };
    }

    if (pathname === "/notifications/") {
      var me6 = requireLogin(db, token);
      var items = [];

      if (me6.profile.role === "pharmacy" && me6.profile.pharmacy_id) {
        var pharmacy6 = db.pharmacies[me6.profile.pharmacy_id];
        var case6 = pharmacy6.active_case_id ? db.cases[pharmacy6.active_case_id] : null;

        if (case6) {
          var cE = 0, cS = 0, vE = 0, vS = 0;
          caseItems(db, case6.case_id, "active").forEach(function (m) {
            var c = classify(m.expiry, case6.today);
            if (c.group === EXPIRED) { cE++; vE = round2(vE + valueAtRisk(m.quantity, m.unit_price_bdt)); }
            if (c.group === SOON30) { cS++; vS = round2(vS + valueAtRisk(m.quantity, m.unit_price_bdt)); }
          });
          if (cE) items.push({ id: "expiry-expired-" + cE, level: "danger",
            title: cE + " items have expired",
            message: "\u09F3 " + money(vE) + " is already lost. Return them to the distributor.",
            view: "alerts", when: null });
          if (cS) items.push({ id: "expiry-soon-" + cS, level: "warning",
            title: cS + " items expire within 30 days",
            message: "\u09F3 " + money(vS) + " still at risk. There is time to return these.",
            view: "alerts", when: null });
        }

        var myOrders = values(db.orders).filter(function (o) { return o.pharmacy_id === me6.profile.pharmacy_id; }).slice(0, 40);
        myOrders.forEach(function (o) {
          var distName = db.distributors[o.distributor_id] ? db.distributors[o.distributor_id].name : "The distributor";
          var when = o.delivered_at || o.decided_at || o.ordered_at;
          if (o.status === "accepted") {
            items.push({ id: "order-" + o.id + "-accepted", level: "info",
              title: "Order #" + o.id + " accepted",
              message: distName + " accepted " + o.medicine_name + " \u00D7 " + o.quantity + ".",
              view: "orders", when: when });
          } else if (o.status === "rejected") {
            items.push({ id: "order-" + o.id + "-rejected", level: "danger",
              title: "Order #" + o.id + " rejected",
              message: distName + " rejected " + o.medicine_name + ".",
              view: "orders", when: when });
          } else if (o.status === "out_for_delivery") {
            items.push({ id: "order-" + o.id + "-out_for_delivery", level: "warning",
              title: "Order #" + o.id + " is out for delivery",
              message: o.medicine_name + " \u00D7 " + o.quantity + " is on its way.",
              view: "orders", when: when });
          } else if (o.status === "delivered" && !o.added_to_inventory) {
            items.push({ id: "order-" + o.id + "-add", level: "success",
              title: "Order #" + o.id + " delivered",
              message: "Add " + o.medicine_name + " to your inventory with its batch and expiry.",
              view: "orders", when: when });
          }
        });
      } else if (me6.profile.role === "distributor" && me6.profile.distributor_id) {
        var did = me6.profile.distributor_id;
        var pending = values(db.orders).filter(function (o) { return o.distributor_id === did && o.status === "pending"; }).slice(0, 20);
        pending.forEach(function (o) {
          var phName = db.pharmacies[o.pharmacy_id] ? db.pharmacies[o.pharmacy_id].name : "";
          items.push({ id: "order-" + o.id + "-pending", level: "info",
            title: "New request from " + phName,
            message: o.medicine_name + " \u00D7 " + o.quantity + " " + o.unit.toLowerCase() + ". Accept or reject it.",
            view: "requests", when: o.ordered_at });
        });

        var moving = values(db.orders).filter(function (o) {
          return o.distributor_id === did && (o.status === "accepted" || o.status === "out_for_delivery");
        }).slice(0, 20);
        moving.forEach(function (o) {
          var phName = db.pharmacies[o.pharmacy_id] ? db.pharmacies[o.pharmacy_id].name : "";
          var nxt = o.status === "accepted" ? "Mark it out for delivery." : "Mark it delivered.";
          items.push({ id: "order-" + o.id + "-" + o.status, level: "warning",
            title: "Order #" + o.id + " needs a delivery update",
            message: phName + " \u00B7 " + o.medicine_name + ". " + nxt,
            view: "deliveries", when: (o.decided_at || o.ordered_at) });
        });

        var empty = values(db.distributorMedicines).filter(function (m) {
          return m.distributor_id === did && m.is_active && m.available_quantity === 0;
        }).slice(0, 10);
        empty.forEach(function (m) {
          items.push({ id: "stock-empty-" + m.id, level: "danger",
            title: m.name + " is out of stock",
            message: "Pharmacies cannot order it until you restock.",
            view: "catalogue", when: null });
        });
      }

      var order = { danger: 0, warning: 1, success: 2, info: 3 };
      items.sort(function (a, b) {
        var oa = order.hasOwnProperty(a.level) ? order[a.level] : 9;
        var ob = order.hasOwnProperty(b.level) ? order[b.level] : 9;
        if (oa !== ob) return oa - ob;
        return a.id < b.id ? -1 : 1;
      });

      return { notifications: items, total: items.length };
    }

    /* ---------------- pharmacy: ordering ---------------- */

    if (pathname === "/orders/catalogue/") {
      requireRole(db, token, "pharmacy");
      var result = values(db.distributors).map(function (d) {
        var meds = values(db.distributorMedicines).filter(function (m) {
          return m.distributor_id === d.id && m.is_active && m.available_quantity > 0;
        }).map(function (m) {
          return { id: m.id, name: m.name, company: m.company, unit: m.unit,
                   available_quantity: m.available_quantity, unit_price_bdt: money(m.unit_price_bdt) };
        });
        return meds.length ? { id: d.id, name: d.name, address: d.address, medicines: meds } : null;
      }).filter(Boolean);
      return { distributors: result };
    }

    if (method === "POST" && pathname === "/orders/place/") {
      var me7 = requireRole(db, token, "pharmacy");
      var quantity = parseInt(body.quantity, 10);
      if (!body.medicine_id) fail(404, "medicine_not_found", "That medicine is not available.");
      if (!quantity || isNaN(quantity)) fail(400, "bad_quantity", "Quantity must be a whole number.");
      if (quantity <= 0) fail(400, "bad_quantity", "Enter a quantity of 1 or more.");

      var med = db.distributorMedicines[body.medicine_id];
      if (!med || !med.is_active) fail(404, "medicine_not_found", "That medicine is not available.");
      if (quantity > med.available_quantity) {
        fail(400, "not_enough_stock", med.name + ": only " + med.available_quantity + " " + med.unit.toLowerCase() + " available.");
      }

      var oid = nextId(db, "nextOrderId");
      var now = new Date().toISOString();
      db.orders[oid] = {
        id: oid, pharmacy_id: me7.profile.pharmacy_id, distributor_id: med.distributor_id,
        medicine_id: med.id, medicine_name: med.name, unit: med.unit, quantity: quantity,
        status: "pending", note: (body.note || "").slice(0, 200),
        ordered_at: now, decided_at: null, delivered_at: null,
        added_to_inventory: false, inventory_item_id: null
      };
      saveDb(db);
      return { order: serializeOrder(db, db.orders[oid], "pharmacy") };
    }

    if (pathname === "/orders/mine/") {
      var me8 = requireRole(db, token, "pharmacy");
      var status8 = query.get("status");
      var mine = values(db.orders).filter(function (o) { return o.pharmacy_id === me8.profile.pharmacy_id; });
      var filtered = status8 ? mine.filter(function (o) { return o.status === status8; }) : mine;
      filtered.sort(function (a, b) { return a.ordered_at < b.ordered_at ? 1 : -1; });

      var counts8 = { pending: 0, accepted: 0, rejected: 0, out_for_delivery: 0, delivered: 0 };
      mine.forEach(function (o) { counts8[o.status]++; });

      return {
        orders: filtered.map(function (o) { return serializeOrder(db, o, "pharmacy"); }),
        counts: counts8, total: filtered.length
      };
    }

    if (method === "POST" && pathname === "/orders/add-to-inventory/") {
      var me9 = requireRole(db, token, "pharmacy");
      var order9 = db.orders[body.order_id];
      if (!order9 || order9.pharmacy_id !== me9.profile.pharmacy_id) fail(404, "order_not_found", "Order not found.");
      if (order9.status !== "delivered") fail(400, "not_delivered", "Only delivered orders can be added to inventory.");
      if (order9.added_to_inventory) fail(409, "already_added", "This order has already been added to your inventory.");

      var name9 = (body.name || order9.medicine_name).trim();
      var batch9 = (body.batch || "").trim();
      var unit9 = (body.unit || order9.unit || "").trim() || "Units";
      var expiryRaw = (body.expiry || "").trim();

      if (!name9) fail(400, "missing_name", "Enter the medicine name.");
      if (!batch9) fail(400, "missing_batch", "Enter the batch number.");

      var qty9 = parseInt(body.quantity, 10);
      if (isNaN(qty9)) fail(400, "bad_quantity", "Quantity must be a whole number.");
      if (qty9 <= 0) fail(400, "bad_quantity", "Enter a quantity of 1 or more.");

      if (!/^\d{4}-\d{2}-\d{2}$/.test(expiryRaw)) fail(400, "bad_expiry", "Expiry date must look like 2028-05-31.");

      var med9 = db.distributorMedicines[order9.medicine_id];
      var priceRaw = body.unit_price_bdt || (med9 ? med9.unit_price_bdt : "0");
      var price9 = Number(priceRaw);
      if (isNaN(price9)) fail(400, "bad_price", "Unit price must be a number.");

      var pharmacy9 = db.pharmacies[me9.profile.pharmacy_id];
      if (!pharmacy9 || !pharmacy9.active_case_id) {
        fail(400, "no_case", "This pharmacy has no stock case configured.");
      }
      var caseId9 = pharmacy9.active_case_id;

      var existingIds = caseItems(db, caseId9).filter(function (m) {
        return m.item_id.indexOf("PH") === 0;
      }).map(function (m) { return m.item_id; });
      var seq = existingIds.length + 1;
      var itemId9 = "PH" + String(seq).padStart(4, "0");
      while (existingIds.indexOf(itemId9) > -1) { seq++; itemId9 = "PH" + String(seq).padStart(4, "0"); }

      var newId = nextId(db, "nextMedicineId");
      var distName9 = db.distributors[order9.distributor_id] ? db.distributors[order9.distributor_id].name : "";
      var newItem = {
        id: newId, case_id: caseId9, item_id: itemId9, name: name9,
        company: (med9 && med9.company) || distName9, batch: batch9,
        quantity: qty9, unit_price_bdt: price9.toFixed(2), expiry: expiryRaw,
        unit: unit9, status: "active", returned_at: null,
        initially_returned: false, added_by_pharmacy: true,
        added_at: new Date().toISOString()
      };
      db.medicines[newId] = newItem;

      order9.added_to_inventory = true;
      order9.inventory_item_id = newId;
      saveDb(db);

      var caseObj9 = db.cases[caseId9];
      var c9 = classify(newItem.expiry, caseObj9.today);

      return {
        message: name9 + " added to inventory.",
        item: { item_id: newItem.item_id, name: newItem.name, batch: newItem.batch,
                quantity: newItem.quantity, unit: newItem.unit, expiry: newItem.expiry,
                days_left: c9.days, group: c9.group },
        order: serializeOrder(db, order9, "pharmacy")
      };
    }

    /* ---------------- distributor: incoming orders + deliveries ---------------- */

    if (pathname === "/orders/incoming/") {
      var me10 = requireRole(db, token, "distributor");
      var status10 = query.get("status");
      var incoming = values(db.orders).filter(function (o) { return o.distributor_id === me10.profile.distributor_id; });
      var filtered10 = status10 ? incoming.filter(function (o) { return o.status === status10; }) : incoming;
      filtered10.sort(function (a, b) { return a.ordered_at < b.ordered_at ? 1 : -1; });

      var counts10 = { pending: 0, accepted: 0, rejected: 0, out_for_delivery: 0, delivered: 0 };
      incoming.forEach(function (o) { counts10[o.status]++; });

      return {
        orders: filtered10.map(function (o) { return serializeOrder(db, o, "distributor"); }),
        counts: counts10, total: filtered10.length
      };
    }

    if (method === "POST" && pathname === "/orders/status/") {
      var me11 = requireRole(db, token, "distributor");
      var order11 = db.orders[body.order_id];
      if (!order11 || order11.distributor_id !== me11.profile.distributor_id) fail(404, "order_not_found", "Order not found.");

      var newStatus = (body.status || "").trim();
      if (!ORDER_STATUS_LABELS.hasOwnProperty(newStatus)) fail(400, "bad_status", "Unknown status '" + newStatus + "'.");

      var allowed = ALLOWED_NEXT[order11.status] || [];
      if (allowed.indexOf(newStatus) === -1) {
        fail(409, "bad_transition",
          "An order that is '" + (ORDER_STATUS_LABELS[order11.status] || order11.status) +
          "' can only move to: " + (allowed.slice().sort().join(", ") || "nothing") + ".");
      }

      var now11 = new Date().toISOString();
      order11.status = newStatus;
      if (newStatus === "accepted" || newStatus === "rejected") order11.decided_at = now11;
      if (newStatus === "delivered") order11.delivered_at = now11;

      if (newStatus === "accepted") {
        var med11 = db.distributorMedicines[order11.medicine_id];
        if (med11) {
          if (order11.quantity > med11.available_quantity) {
            fail(400, "not_enough_stock", "Only " + med11.available_quantity + " " + med11.unit.toLowerCase() + " left in your catalogue.");
          }
          med11.available_quantity -= order11.quantity;
        }
      }

      saveDb(db);
      return { order: serializeOrder(db, order11, "distributor") };
    }

    if (pathname === "/orders/medicines/") {
      var me12 = requireRole(db, token, "distributor");
      var meds12 = values(db.distributorMedicines).filter(function (m) {
        return m.distributor_id === me12.profile.distributor_id;
      }).sort(function (a, b) { return a.name < b.name ? -1 : 1; }).map(function (m) {
        return { id: m.id, name: m.name, company: m.company, unit: m.unit,
                 available_quantity: m.available_quantity, unit_price_bdt: money(m.unit_price_bdt),
                 is_active: m.is_active };
      });
      return { medicines: meds12, total: meds12.length };
    }

    if (method === "POST" && pathname === "/orders/medicines/save/") {
      var me13 = requireRole(db, token, "distributor");
      var name13 = (body.name || "").trim();
      if (!name13) fail(400, "missing_name", "Enter the medicine name.");

      var qty13 = parseInt(body.available_quantity, 10);
      if (isNaN(qty13)) qty13 = 0;
      if (qty13 < 0) fail(400, "bad_quantity", "Available quantity cannot be negative.");

      var price13 = Number(body.unit_price_bdt || "0");
      if (isNaN(price13)) fail(400, "bad_price", "Unit price must be a number.");

      var existing = values(db.distributorMedicines).filter(function (m) {
        return m.distributor_id === me13.profile.distributor_id && m.name === name13;
      })[0];

      var created = !existing;
      var record = existing || { id: nextId(db, "nextDistMedId"), distributor_id: me13.profile.distributor_id };
      record.name = name13;
      record.company = (body.company || "").trim();
      record.unit = (body.unit || "Tablets").trim();
      record.available_quantity = qty13;
      record.unit_price_bdt = price13.toFixed(2);
      record.is_active = body.is_active === undefined ? true : !!body.is_active;
      db.distributorMedicines[record.id] = record;
      saveDb(db);

      return {
        created: created,
        medicine: { id: record.id, name: record.name, company: record.company, unit: record.unit,
                    available_quantity: record.available_quantity, unit_price_bdt: money(record.unit_price_bdt),
                    is_active: record.is_active }
      };
    }

    fail(404, "not_found", "Unknown endpoint '" + pathname + "'.");
  }

  /* --------------------------------- public API --------------------------------- */

  function request(path, options) {
    options = options || {};
    var method = (options.method || "GET").toUpperCase();
    var headers = options.headers || {};
    var authHeader = headers.Authorization || headers.authorization || "";
    var token = authHeader.indexOf("Token ") === 0 ? authHeader.slice(6).trim() : "";

    var qIndex = path.indexOf("?");
    var pathname = qIndex > -1 ? path.slice(0, qIndex) : path;
    var query = new URLSearchParams(qIndex > -1 ? path.slice(qIndex + 1) : "");

    var body = {};
    if (options.body) {
      try { body = JSON.parse(options.body); }
      catch (e) { return Promise.reject(new ApiError(400, "bad_json", "Request body must be JSON.")); }
    }

    // Simulated latency keeps the existing loading/disabled-button UI honest.
    return new Promise(function (resolve, reject) {
      setTimeout(function () {
        try {
          resolve(route(method, pathname, query, body, token));
        } catch (e) {
          if (e instanceof ApiError) reject(e);
          else { console.error(e); reject(new ApiError(500, "server_error", "Something went wrong.")); }
        }
      }, 120);
    });
  }

  function resetAllData() {
    localStorage.removeItem(DB_KEY);
    seedDatabase();
  }

  return { request: request, resetAllData: resetAllData };
})();
