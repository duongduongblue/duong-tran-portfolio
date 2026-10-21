// Headless checks for work/recruitment-dashboard.html.
// Usage: node scripts/check-recruitment-dashboard.mjs
import fs from "node:fs";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = 9334;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PAGE = "file://" + path.join(ROOT, "work", "recruitment-dashboard.html");
const PROFILE = "/tmp/chrome-dash-check-52e4";
const CHROME = process.env.CHROME || "google-chrome";

function audit(mode) {
  var log = [];
  function check(name, cond, detail) {
    log.push((cond ? "PASS " : "FAIL ") + name + (!cond && detail ? " -- " + detail : ""));
  }
  function text(id) {
    var el = document.getElementById(id);
    return el ? el.textContent : "";
  }
  function sentences(s) {
    return s.split(/[.]+/).map(function (x) { return x.trim(); }).filter(Boolean);
  }
  function regionBlob(ids) {
    return ids.map(function (id) { return text(id); }).join("\n");
  }
  function cmpLines() {
    return Array.prototype.map.call(document.querySelectorAll("#cmp p"), function (p) {
      var k = p.querySelector(".k");
      var spans = Array.prototype.filter.call(p.querySelectorAll("span"), function (s) { return s !== k; });
      return {
        raw: p.textContent,
        label: k ? k.textContent : "",
        spans: Array.prototype.map.call(spans, function (s) { return s.textContent; })
      };
    });
  }
  function sourceRows() {
    return Array.prototype.map.call(document.querySelectorAll("#src .r"), function (r) {
      var d = r.querySelector(".d");
      var mom = null;
      var yoy = null;
      if (d) {
        var html = d.innerHTML;
        var m = html.match(/^MoM (?:<span class="(?:up|dn|flat)">([^<]*)<\/span>|-) \| YoY (?:<span class="(?:up|dn|flat)">([^<]*)<\/span>|-)$/);
        mom = m ? (m[1] || "-") : "PARSE";
        yoy = m ? (m[2] || "-") : html;
      }
      var value = r.querySelector(".v").textContent;
      return { name: r.firstElementChild.textContent, value: value, mom: mom, yoy: yoy };
    });
  }
  function cvOf(obj, k) {
    if (!obj || !obj.src || obj.src[k] == null) return obj ? 0 : null;
    return obj.src[k][0];
  }
  function badNumber(s) {
    return s.indexOf("Infinity") !== -1 || s.indexOf("NaN") !== -1;
  }
  function sumPairs(rows, key) {
    var out = {};
    rows.forEach(function (row) {
      if (!row) return;
      Object.keys(row[key]).forEach(function (k) {
        if (!out[k]) out[k] = key === "stage" ? 0 : [0, 0];
        if (key === "stage") out[k] += row.stage[k];
        else { out[k][0] += row[key][k][0]; out[k][1] += row[key][k][1]; }
      });
    });
    return out;
  }
  function sameMap(a, b) {
    var keys = {};
    Object.keys(a || {}).forEach(function (k) { keys[k] = 1; });
    Object.keys(b || {}).forEach(function (k) { keys[k] = 1; });
    var bad = [];
    Object.keys(keys).forEach(function (k) {
      if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) bad.push(k + " got " + JSON.stringify(a[k]) + " want " + JSON.stringify(b[k]));
    });
    return bad;
  }

  var expectYears = {
    "2022": [928, 35, 148, 46, 36, "15.9% | 31.1% | 76.1%", "76.1%"],
    "2023": [586, 14, 62, 20, 48, "10.6% | 32.3% | 70.0%", "70.0%"],
    "2024": [945, 50, 168, 64, 33, "17.8% | 38.1% | 78.1%", "78.1%"],
    "2025": [1507, 73, 255, 91, 29, "16.9% | 35.7% | 80.2%", "80.2%"],
    "2026": [534, 20, 86, 27, 32, "16.1% | 31.4% | 74.1%", "74.1%"]
  };

  if (mode === "desktop") {
    var totalCv = 0;
    var totalH = 0;
    var orderFails = 0;
    ["2022", "2023", "2024", "2025", "2026"].forEach(function (y) {
      var rows = M[y];
      var cv = 0;
      var hired = 0;
      var iv = 0;
      var of = 0;
      var present = 0;
      rows.forEach(function (row, i) {
        if (!row) return;
        present += 1;
        cv += row.cv;
        hired += row.hired;
        iv += row.iv;
        of += row.of;
        var joined = row.stage.Hired || 0;
        if (!(row.hired <= row.of && row.of <= row.iv && row.iv <= row.cv) || joined !== row.hired || (row.hired === 0) !== (row.days == null)) {
          orderFails += 1;
          check(y + " m" + (i + 1) + " funnel", false, [row.cv, row.iv, row.of, row.hired, row.days].join(" "));
        }
        ["src", "loc", "grp"].forEach(function (key) {
          var sc = 0;
          var sh = 0;
          Object.keys(row[key]).forEach(function (k) { sc += row[key][k][0]; sh += row[key][k][1]; });
          if (sc !== row.cv || sh !== row.hired) {
            orderFails += 1;
            check(y + " m" + (i + 1) + " " + key, false, sc + "/" + sh);
          }
        });
        var st = 0;
        Object.keys(row.stage).forEach(function (k) { st += row.stage[k]; });
        if (st !== row.cv) {
          orderFails += 1;
          check(y + " m" + (i + 1) + " stage", false, String(st));
        }
      });
      var want = expectYears[y];
      var nulls = rows.filter(function (row) { return !row; }).length;
      check(y + " months sum to " + want[0] + " CVs and " + want[1] + " hires", cv === want[0] && hired === want[1] && cv === D[y].cv && hired === D[y].hired, cv + "/" + hired);
      check(y + " funnel totals", iv === want[2] && of === want[3], iv + "/" + of);
      check(y + " weighted days", (function () {
        var w = 0;
        var h = 0;
        rows.forEach(function (row) {
          if (row && row.hired && row.days != null) { w += row.days * row.hired; h += row.hired; }
        });
        return (h ? Math.round(w / h) : null) === want[4];
      })(), String(want[4]));
      if (y === "2026") check("2026 Nov and Dec are null, not 0", rows[10] == null && rows[11] == null && nulls === 2 && present === 10);
      else check(y + " has 12 months", present === 12 && nulls === 0);
      ["src", "loc", "grp", "stage"].forEach(function (key) {
        var got = sumPairs(rows, key);
        var diff = sameMap(got, D[y][key]);
        check(y + " " + key + " months sum to the year", diff.length === 0, diff.slice(0, 3).join("; "));
      });
      totalCv += cv;
      totalH += hired;
    });
    check("years sum to 4,500 CVs and 192 hires", totalCv === 4500 && totalH === 192 && D.all.cv === 4500 && D.all.hired === 192, totalCv + "/" + totalH);
    check("every month keeps hired <= offers <= interviews <= CVs, joined == hires, and days blank only when nobody was hired", orderFails === 0);
    check("delta hides a 0 or missing base", delta(1, 0).text === "-" && delta(0, 0).text === "-" && delta(null, 5).text === "-" && delta(5, null).text === "-" && delta(0, 3).text === "-100.0%");
    check("delta never returns Infinity or NaN", [delta(1, 0), delta(0, 0), delta(null, 1), delta(0, 3), delta(10, 7)].every(function (d) {
      return d.text.indexOf("Infinity") === -1 && d.text.indexOf("NaN") === -1;
    }));
    var july = M["2023"][6];
    var august = M["2023"][7];
    check("2023 July and August hired nobody", july.hired === 0 && august.hired === 0 && july.days == null && august.days == null && july.of === 0 && august.of === 0);

    var takeaways = {
      y2022: "35 of 46 offers were accepted, and referrals made 11 of the 35 hires. The sample average was 36 days to hire.",
      y2023: "CVs fell to 586 and hiring paused at 14 people, with none hired in July or August. Job boards were used for the last time, and the sample average was 48 days to hire.",
      y2024: "Hiring restarted with 50 hires from 945 CVs, and 50 of 64 offers were accepted. Direct email was 27% of CVs and the best source by conversion.",
      y2025: "This was the peak: 1,507 CVs, 73 hires, and the shortest sample time to hire at 29 days. Art & Game Design was 73% of CVs and 60 of the hires.",
      y2026: "January to October brought 534 CVs and 20 hires; November and December are not yet. Most of that hiring is in Ho Chi Minh City, 13 of 20 hires."
    };
    Object.keys(takeaways).forEach(function (id) {
      var body = document.querySelector("#" + id + " p").textContent;
      check(id + " takeaway", body === takeaways[id] && sentences(body).length >= 1 && sentences(body).length <= 2, body);
    });
    check("2022 takeaway matches counts", D["2022"].hired === 35 && D["2022"].src.Referral[1] === 11);
    check("2024 takeaway matches counts", D["2024"].src["Direct email"][0] === 255 && Math.round(100 * 255 / 945) === 27 && bestSource(slice("2024", "all")).name === "Direct email");
    check("2025 takeaway matches counts", D["2025"].grp["Art & Game Design"][0] === 1093 && D["2025"].grp["Art & Game Design"][1] === 60 && Math.round(100 * 1093 / 1507) === 73);
    check("2026 takeaway matches counts", D["2026"].loc.HCM[1] === 13);
    check("job boards end in 2023", D["2023"].src["Job boards"][0] > 0 && !D["2024"].src["Job boards"] && !D["2025"].src["Job boards"] && !D["2026"].src["Job boards"]);
    var css = document.querySelector("style").textContent;
    var bs = String.fromCharCode(92);
    check("arrow glyphs use CSS escapes", css.indexOf(bs + "2191") !== -1 && css.indexOf(bs + "2193") !== -1 && css.indexOf("&#") === -1);
    check("illustrative banner", document.querySelector(".banner").textContent === "Illustrative sample data. Figures are anonymized and do not reflect actual company numbers.");
    var fontHref = Array.prototype.map.call(document.querySelectorAll("link[rel=stylesheet]"), function (l) { return l.getAttribute("href"); }).join(" ");
    check("fonts stay Cormorant Garamond and Inter", fontHref.indexOf("Cormorant+Garamond") !== -1 && fontHref.indexOf("Inter") !== -1);
  }

  var sweepBad = [];
  var worst = 0;
  var worstKey = "";
  YS.forEach(function (y) {
    ["all"].concat(MONTHS.map(function (_, i) { return String(i + 1); })).forEach(function (m) {
      var key = y + " " + m;
      try {
        show(y, m);
      } catch (err) {
        sweepBad.push(key + " threw " + err.message);
        return;
      }
      var live = regionBlob(["kpis", "cmp", "src", "grp", "loc", "stg", "vol", "trend", "trendNote", "volLead"]);
      if (badNumber(live) || badNumber(document.body.textContent)) sweepBad.push(key + " has Infinity or NaN");
      var missing = m !== "all" && !slice(y, m);
      if (missing) {
        ["k1", "k2", "k3", "k4", "k5", "kDays", "kFun", "kBest", "kAcc"].forEach(function (id) {
          if (text(id) !== "not yet") sweepBad.push(key + " " + id + "=" + text(id));
        });
        var raw = cmpLines().map(function (line) { return line.raw; });
        if (raw.join(" | ") !== "MoM: - | YoY: -") sweepBad.push(key + " cmp " + raw.join(" | "));
        if (/-100/.test(live) || /\b0\b/.test(live)) sweepBad.push(key + " shows 0 or -100");
        if (text("src").indexOf("Not yet") === -1 || text("vol").indexOf("Not yet") === -1 || text("trend").indexOf("Not yet") === -1) {
          sweepBad.push(key + " charts are not blank");
        }
      } else {
        var d = slice(y, m);
        if (text("k1") !== f(d.cv) || text("k2") !== f(d.hired) || text("k3") !== pc(d.hired, d.cv)) {
          sweepBad.push(key + " KPIs " + [text("k1"), text("k2"), text("k3")].join(" "));
        }
        if (text("k2") === "not yet") sweepBad.push(key + " unexpectedly not yet");
        var rows = sourceRows();
        var cvSum = 0;
        var hireSum = 0;
        rows.forEach(function (row) {
          cvSum += parseInt(row.value.replace(/,/g, ""), 10) || 0;
          var hm = row.value.match(/\((\d+)\)/);
          hireSum += hm ? +hm[1] : 0;
        });
        if (cvSum !== d.cv || hireSum !== d.hired) sweepBad.push(key + " source sum " + cvSum + "/" + hireSum);
        if (m === "all") {
          if (text("src").indexOf("MoM") !== -1) sweepBad.push(key + " has MoM without a month");
        } else {
          if (text("src").indexOf("MoM") === -1 || text("src").indexOf("YoY") === -1) sweepBad.push(key + " source mix lacks MoM/YoY");
          var lines = cmpLines();
          var pm = prevPeriod(y, +m);
          var prev = pm ? slice(pm[0], String(pm[1])) : null;
          var mom = lines[0];
          if (!pm || !prev) {
            if (!mom || mom.raw !== "MoM: -") sweepBad.push(key + " MoM " + (mom && mom.raw));
          } else if (!mom || mom.spans[0] !== delta(d.cv, prev.cv).text || mom.spans[1] !== delta(d.hired, prev.hired).text || mom.spans[2] !== delta(rate(d.hired, d.cv), rate(prev.hired, prev.cv)).text) {
            sweepBad.push(key + " MoM " + (mom && mom.spans.join(",")));
          }
          var yy = yoyPeriod(y, +m);
          var prior = yy ? slice(yy[0], String(yy[1])) : null;
          var yline = lines[1];
          if (!yy || !prior) {
            if (!yline || yline.raw !== "YoY: -") sweepBad.push(key + " YoY " + (yline && yline.raw));
          } else if (!yline || yline.spans[0] !== delta(d.cv, prior.cv).text || yline.spans[1] !== delta(d.hired, prior.hired).text || yline.spans[2] !== delta(rate(d.hired, d.cv), rate(prior.hired, prior.cv)).text) {
            sweepBad.push(key + " YoY " + (yline && yline.spans.join(",")));
          }
          rows.forEach(function (row) {
            var curC = d.src[row.name][0];
            var wantM = prev ? delta(curC, cvOf(prev, row.name)).text : "-";
            var wantY = prior ? delta(curC, cvOf(prior, row.name)).text : "-";
            if (row.mom !== wantM || row.yoy !== wantY) sweepBad.push(key + " " + row.name + " " + row.mom + "/" + row.yoy + " want " + wantM + "/" + wantY);
          });
        }
      }
      if (mode === "mobile") {
        var gap = document.documentElement.scrollWidth - document.documentElement.clientWidth;
        if (gap > worst) { worst = gap; worstKey = key; }
      }
    });
  });
  check("every year/month view stays finite and consistent", sweepBad.length === 0, sweepBad.slice(0, 6).join(" | "));

  function open(y, m) {
    var yb = document.querySelector('#yrs button[data-v="' + y + '"]');
    var mb = document.querySelector('#mos button[data-v="' + m + '"]');
    yb.click();
    mb.click();
    return { yOn: yb.classList.contains("on"), mOn: mb.classList.contains("on"), yOff: yb.disabled, mOff: mb.disabled };
  }

  var sep = open("2025", "9");
  check("Sep 2025 buttons select", sep.yOn && sep.mOn && !sep.mOff);
  check("Sep 2025 shows CVs, hires, and conversion", text("k1") === "182" && text("k2") === "10" && text("k3") === "5.5%");
  check("Sep 2025 days, funnel, best source, acceptance", text("kDays") === "27" && text("kFun") === "17.6% | 37.5% | 83.3%" && text("kBest") === "Facebook" && text("kBestN") === "12.5% from 8 CVs" && text("kAcc") === "83.3%" && text("kAccN") === "10 of 12 offers");
  check("Sep 2025 joined equals hires", text("kAccN").indexOf("10 of ") === 0 && text("k2") === "10");
  check("Sep 2025 top source and referral share", text("k5") === "Direct email" && text("k5n") === "80 CVs, 7 hires" && text("k4") === "10.0%" && text("k4n") === "1 of 10 hires");
  var sepCmp = cmpLines();
  check("Sep 2025 MoM", sepCmp[0].label === "MoM vs Aug 2025" && sepCmp[0].spans.join(" ") === "+32.8% +42.9% +7.5%", sepCmp[0] && sepCmp[0].spans.join(" "));
  check("Sep 2025 YoY", sepCmp[1].label === "YoY vs Sep 2024" && sepCmp[1].spans.join(" ") === "+70.1% +42.9% -16.0%", sepCmp[1] && sepCmp[1].spans.join(" "));
  var direct = sourceRows().filter(function (row) { return row.name === "Direct email"; })[0];
  check("Sep 2025 source mix MoM and YoY", !!direct && direct.value.indexOf("80 (7)") === 0 && direct.mom === "+35.6%" && direct.yoy === "+175.9%", direct && (direct.mom + " " + direct.yoy));
  var up = document.querySelector("#cmp .up");
  var dn = document.querySelector("#cmp .dn");
  check("comparison arrows render", !!up && !!dn && getComputedStyle(up, "::before").content.indexOf("\u2191") !== -1 && getComputedStyle(dn, "::before").content.indexOf("\u2193") !== -1);
  check("Sep 2025 innerText has no literal entities", !/&#|&amp;/.test(document.body.innerText));

  var aug = open("2023", "8");
  var augCmp = cmpLines();
  check("Aug 2023 MoM hires is '-' against a 0 base", aug.mOn && augCmp[0].spans[1] === "-" && augCmp[0].spans[2] === "-" && text("k2") === "0" && text("kDays") === "-" && text("kAcc") === "-");
  check("Aug 2023 YoY hires is a real -100.0%, not Infinity", augCmp[1].spans[1] === "-100.0%" && augCmp[1].spans.join(" ").indexOf("Infinity") === -1);

  var sep23 = open("2023", "9");
  check("Sep 2023 MoM hires is '-' against a 0 base", sep23.mOn && cmpLines()[0].spans[1] === "-" && text("k2") === "1");

  var jan = open("2022", "1");
  var janCmp = cmpLines();
  var janSources = sourceRows();
  check("Jan 2022 missing base is '-'", janCmp[0].raw === "MoM: -" && janCmp[1].raw === "YoY: -" && text("k1") === "69" && text("k2") === "3" && janSources.length > 0 && janSources.every(function (row) { return row.mom === "-" && row.yoy === "-"; }));

  open("2026", "3");
  var missingSource = sourceRows().filter(function (row) { return row.name === "Not recorded"; })[0];
  check("Mar 2026 MoM is '-' when that source was absent in February", !!missingSource && missingSource.mom === "-", missingSource && missingSource.mom);

  open("2026", "11");
  check("Nov 2026 is not yet", text("k1") === "not yet" && text("k2") === "not yet" && text("k3") === "not yet" && text("kFun") === "not yet" && cmpLines().map(function (l) { return l.raw; }).join(" | ") === "MoM: - | YoY: -");
  check("Nov 2026 button stays enabled", document.querySelector('#mos button[data-v="11"]').disabled === false);
  open("2026", "12");
  check("Dec 2026 is not yet", text("k1") === "not yet" && text("kAcc") === "not yet" && text("src") === "Not yet" && text("trend") === "Not yet" && text("vol") === "Not yet");
  check("Dec 2026 button stays enabled", document.querySelector('#mos button[data-v="12"]').disabled === false);

  open("all", "11");
  var novGroup = document.querySelectorAll("#vol svg g");
  var nov2026 = novGroup[novGroup.length - 1].textContent;
  check("all-years November keeps 2026 blank", nov2026.indexOf("not yet") !== -1 && !/\b0\b/.test(nov2026) && nov2026.indexOf("-100") === -1, nov2026);

  open("2026", "all");
  var monthLabels = Array.prototype.filter.call(document.querySelectorAll("#trend text"), function (t) { return t.getAttribute("y") === "248"; });
  check("2026 trend labels Nov and Dec not yet", monthLabels.length === 12 && monthLabels[10].textContent === "not yet" && monthLabels[11].textContent === "not yet");

  open("all", "all");
  check("all-years KPIs", text("k1") === "4,500" && text("k2") === "192" && text("k3") === "4.3%" && text("k4") === "19.3%" && text("kDays") === "33" && text("kBest") === "Referral" && text("kAcc") === "77.4%" && text("kAccN") === "192 of 248 offers");
  open("2022", "all");
  check("2022 year KPIs", text("k1") === "928" && text("k2") === "35" && text("kDays") === "36" && text("kFun") === "15.9% | 31.1% | 76.1%" && text("kAcc") === "76.1%" && text("kAccN") === "35 of 46 offers");
  open("2024", "all");
  check("2024 best source is Direct email", text("kBest") === "Direct email" && text("kDays") === "33" && text("kFun") === "17.8% | 38.1% | 78.1%");
  open("2025", "all");
  check("2025 year KPIs", text("kDays") === "29" && text("kFun") === "16.9% | 35.7% | 80.2%" && text("k2") === "73");
  open("2023", "all");
  check("2023 year days", text("kDays") === "48" && text("k1") === "586" && text("k2") === "14");
  open("2026", "all");
  check("2026 YTD KPIs", text("k1") === "534" && text("k2") === "20" && text("kDays") === "32" && text("kFun") === "16.1% | 31.4% | 74.1%");

  function chartMetrics(id) {
    var svg = document.querySelector("#" + id + " svg");
    if (!svg) return null;
    var box = svg.getBoundingClientRect();
    var worst = 999;
    var sample = "";
    Array.prototype.forEach.call(svg.querySelectorAll("text"), function (t) {
      var ctm = t.getScreenCTM();
      if (!ctm) return;
      var sx = Math.sqrt(ctm.a * ctm.a + ctm.b * ctm.b);
      var sy = Math.sqrt(ctm.c * ctm.c + ctm.d * ctm.d);
      var specified = parseFloat(window.getComputedStyle(t).fontSize);
      var rendered = specified * Math.min(sx, sy);
      if (rendered < worst) { worst = rendered; sample = t.textContent; }
    });
    var sc = svg.closest(".chart-scroll");
    var cs = window.getComputedStyle(sc);
    return {
      worst: Math.round(worst * 10) / 10,
      sample: sample,
      h: Math.round(box.height),
      w: Math.round(box.width),
      overflowX: cs.overflowX,
      scroll: sc.scrollWidth,
      client: sc.clientWidth
    };
  }
  if (mode === "mobile") {
    ["trend", "vol"].forEach(function (id) {
      var metrics = chartMetrics(id);
      check(id + " axis labels are at least 11px at 390", !!metrics && metrics.worst >= 11, metrics && (metrics.worst + "px (" + metrics.sample + ")"));
      check(id + " chart canvas is at least 640 by 260", !!metrics && metrics.w >= 640 && metrics.h >= 260, metrics && (metrics.w + "x" + metrics.h));
      check(id + " chart scrolls sideways inside the page", !!metrics && (metrics.overflowX === "auto" || metrics.overflowX === "scroll") && metrics.scroll >= 640 && metrics.scroll > metrics.client + 1, metrics && (metrics.overflowX + " " + metrics.scroll + "/" + metrics.client));
      if (metrics) log.push("INFO " + id + " labels " + metrics.worst + "px canvas " + metrics.w + "x" + metrics.h);
    });
    var mos = document.getElementById("mos");
    var cols = window.getComputedStyle(mos).gridTemplateColumns.split(/\s+/).filter(Boolean);
    var monthBtns = Array.prototype.slice.call(mos.querySelectorAll("button")).slice(1);
    var rowMap = [];
    monthBtns.forEach(function (b) {
      var top = Math.round(b.getBoundingClientRect().top);
      var found = null;
      rowMap.forEach(function (row) { if (Math.abs(row.top - top) <= 2) found = row; });
      if (!found) { found = { top: top, items: [] }; rowMap.push(found); }
      found.items.push(b);
    });
    rowMap.sort(function (a, b) { return a.top - b.top; });
    var even = rowMap.length === 2 && rowMap.every(function (row) {
      if (row.items.length !== 6) return false;
      var widths = row.items.map(function (b) { return b.getBoundingClientRect().width; });
      return Math.max.apply(null, widths) - Math.min.apply(null, widths) <= 2;
    });
    var allBox = mos.querySelector('button[data-v="all"]').getBoundingClientRect();
    var firstBox = rowMap[0] ? rowMap[0].items[0].getBoundingClientRect() : null;
    var decBox = mos.querySelector('button[data-v="12"]').getBoundingClientRect();
    var julBox = mos.querySelector('button[data-v="7"]').getBoundingClientRect();
    check("month buttons are 6 per row at 390", even && cols.length === 6 && window.getComputedStyle(mos).display === "grid", rowMap.map(function (row) { return row.items.length; }).join(",") + " cols " + cols.join(" "));
    check("All sits on its own full-width row", !!firstBox && allBox.bottom <= firstBox.top + 1 && allBox.width >= firstBox.width * 4, firstBox && (Math.round(allBox.width) + " vs " + Math.round(firstBox.width)));
    check("Dec shares a full row with Jul", !!rowMap[1] && rowMap[1].items.length === 6 && Math.abs(decBox.top - julBox.top) <= 2);
    check("mobile width is 390", window.innerWidth === 390, "inner " + window.innerWidth + " client " + document.documentElement.clientWidth + " visual " + (window.visualViewport && window.visualViewport.width));
    check("mobile has no horizontal overflow", worst <= 1, worstKey + " gap " + worst + " client " + document.documentElement.clientWidth);
    var taps = [];
    [["yrs", "all"], ["yrs", "2025"], ["yrs", "2026"], ["mos", "all"], ["mos", "1"], ["mos", "9"], ["mos", "11"], ["mos", "12"]].forEach(function (pair) {
      var b = document.querySelector("#" + pair[0] + ' button[data-v="' + pair[1] + '"]');
      b.scrollIntoView({ block: "center", inline: "nearest" });
      var r = b.getBoundingClientRect();
      var hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      var inside = r.left >= -1 && r.right <= document.documentElement.clientWidth + 1;
      taps.push(pair.join(":") + (b.disabled || r.height < 28 || r.width < 28 || !inside || !(hit === b || b.contains(hit)) ? " FAIL " + Math.round(r.width) + "x" + Math.round(r.height) : " ok"));
    });
    check("mobile filters are tappable", taps.every(function (t) { return t.indexOf("FAIL") === -1; }), taps.join(", "));
    open("2025", "9");
    var mobileGap = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    check("Sep 2025 usable at 390", text("k1") === "182" && text("k3") === "5.5%" && text("src").indexOf("MoM") !== -1 && mobileGap <= 1 && getComputedStyle(document.querySelector(".bars .r")).display === "block", "gap " + mobileGap);
    open("2026", "11");
    check("Nov 2026 usable at 390", text("k1") === "not yet" && document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
    log.push("INFO mobile innerWidth " + window.innerWidth + " clientWidth " + document.documentElement.clientWidth + " scrollWidth " + document.documentElement.scrollWidth + " worstGap " + worst);
  } else {
    var deskTrend = chartMetrics("trend");
    var deskVol = chartMetrics("vol");
    var trendSvg = document.querySelector("#trend svg");
    var trendBox = trendSvg.getBoundingClientRect();
    var trendVb = trendSvg.viewBox.baseVal;
    check("desktop charts stay full width", !!deskTrend && !!deskVol && deskTrend.w > 700 && deskVol.w > 700 && deskTrend.overflowX === "visible" && deskTrend.scroll <= deskTrend.client + 1 && deskVol.scroll <= deskVol.client + 1, deskTrend && (deskTrend.w + "px " + deskTrend.overflowX + " scroll " + deskTrend.scroll + "/" + deskTrend.client));
    check("desktop trend keeps its aspect ratio", Math.abs(trendBox.width / trendBox.height - trendVb.width / trendVb.height) < 0.05, Math.round(trendBox.width) + "x" + Math.round(trendBox.height));
    check("desktop month buttons stay in a wrapping row", window.getComputedStyle(document.getElementById("mos")).display === "flex");
    log.push("INFO desktop innerWidth " + window.innerWidth + " clientWidth " + document.documentElement.clientWidth);
  }
  check("no page errors", !window.__errs || window.__errs.length === 0, (window.__errs || []).join(" | "));
  return log;
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.next = 1;
    this.pending = new Map();
    this.listeners = [];
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const job = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) job.reject(new Error(JSON.stringify(msg.error)));
        else job.resolve(msg.result || {});
      } else if (msg.method) {
        for (const fn of this.listeners) fn(msg);
      }
    });
  }
  on(fn) { this.listeners.push(fn); }
  send(method, params = {}) {
    const id = this.next++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
}

async function evalJson(cdp, expression) {
  const batch = await cdp.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true
  });
  if (batch.exceptionDetails) {
    throw new Error(batch.exceptionDetails.text || "eval failed");
  }
  return batch.result && batch.result.value;
}

async function saveShot(cdp, file, clip) {
  const params = { format: "png", captureBeyondViewport: true };
  if (clip) params.clip = clip;
  const shot = await cdp.send("Page.captureScreenshot", params);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(shot.data, "base64"));
  console.log("SAVED " + file);
}

async function saveMobileShots(cdp, dir) {
  const layout = await evalJson(cdp, `(function(){
    show("all","all");
    document.querySelectorAll(".chart-scroll").forEach(function(el){ el.scrollLeft = 0; });
    window.scrollTo(0,0);
    var mos = document.getElementById("ml").parentElement.getBoundingClientRect();
    var trend = document.querySelector("#trend").closest(".chart-scroll").getBoundingClientRect();
    var vol = document.querySelector("#vol").closest(".chart-scroll").getBoundingClientRect();
    return {
      mosY: mos.top + window.scrollY,
      mosH: mos.height,
      trendY: trend.top + window.scrollY,
      volY: vol.top + window.scrollY,
      volH: vol.height,
      pageW: document.documentElement.clientWidth
    };
  })()`);
  await saveShot(cdp, path.join(dir, "dashboard_mobile_390_months.png"), {
    x: 0,
    y: Math.max(0, layout.mosY - 12),
    width: layout.pageW,
    height: layout.mosH + 28,
    scale: 2
  });
  await saveShot(cdp, path.join(dir, "dashboard_mobile_390_charts.png"), {
    x: 0,
    y: Math.max(0, layout.trendY - 72),
    width: layout.pageW,
    height: layout.volY + layout.volH - layout.trendY + 130,
    scale: 2
  });
  await evalJson(cdp, `document.querySelector("#trend").closest(".chart-scroll").scrollLeft = 260`);
  await saveShot(cdp, path.join(dir, "dashboard_mobile_390_trend_scrolled.png"), {
    x: 0,
    y: Math.max(0, layout.trendY - 72),
    width: layout.pageW,
    height: 380,
    scale: 2
  });
  const monthly = await evalJson(cdp, `(function(){
    show("2025","9");
    document.querySelectorAll(".chart-scroll").forEach(function(el){ el.scrollLeft = 0; });
    var trend = document.querySelector("#trend").closest(".chart-scroll").getBoundingClientRect();
    var vol = document.querySelector("#vol").closest(".chart-scroll").getBoundingClientRect();
    return {
      trendY: trend.top + window.scrollY,
      volY: vol.top + window.scrollY,
      volH: vol.height,
      pageW: document.documentElement.clientWidth
    };
  })()`);
  await saveShot(cdp, path.join(dir, "dashboard_mobile_390_sep2025_charts.png"), {
    x: 0,
    y: Math.max(0, monthly.trendY - 72),
    width: monthly.pageW,
    height: monthly.volY + monthly.volH - monthly.trendY + 130,
    scale: 2
  });
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    delay(ms).then(() => { throw new Error("timeout " + label); })
  ]);
}

async function waitForChrome() {
  const started = Date.now();
  while (Date.now() - started < 20000) {
    try {
      const res = await fetch("http://127.0.0.1:" + PORT + "/json/version");
      if (res.ok) return;
    } catch (err) { /* retry */ }
    await delay(200);
  }
  throw new Error("Chrome did not open port " + PORT);
}

async function newPage() {
  let last = "";
  for (const method of ["PUT", "GET"]) {
    const res = await fetch("http://127.0.0.1:" + PORT + "/json/new?" + encodeURIComponent("about:blank"), { method });
    last = await res.text();
    if (res.ok) return JSON.parse(last);
  }
  throw new Error("json/new failed " + last);
}

async function loadAt(cdp, width, height, mobile) {
  const metrics = { width, height, deviceScaleFactor: 1, mobile, screenWidth: width, screenHeight: height };
  await cdp.send("Emulation.setDeviceMetricsOverride", metrics);
  const loaded = new Promise((resolve) => {
    const fn = (msg) => {
      if (msg.method === "Page.loadEventFired") {
        cdp.listeners = cdp.listeners.filter((x) => x !== fn);
        resolve();
      }
    };
    cdp.on(fn);
  });
  await cdp.send("Page.navigate", { url: PAGE });
  await withTimeout(loaded, 15000, "load");
  await cdp.send("Emulation.setDeviceMetricsOverride", metrics);
  await withTimeout(cdp.send("Runtime.evaluate", {
    expression: "Promise.all([document.fonts.ready, new Promise(function(r){requestAnimationFrame(function(){requestAnimationFrame(r);});})])",
    awaitPromise: true
  }), 15000, "fonts");
}

async function main() {
  const chrome = spawn(CHROME, [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--remote-debugging-port=" + PORT,
    "--user-data-dir=" + PROFILE,
    "about:blank"
  ], { stdio: "ignore" });
  let failed = false;
  try {
    await waitForChrome();
    const page = await newPage();
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await withTimeout(new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve);
      ws.addEventListener("error", () => reject(new Error("websocket failed")));
    }), 10000, "websocket");
    const cdp = new Cdp(ws);
    const runtimeErrors = [];
    cdp.on((msg) => {
      if (msg.method === "Runtime.exceptionThrown") {
        runtimeErrors.push(msg.params.exceptionDetails.exception && msg.params.exceptionDetails.exception.description || msg.params.exceptionDetails.text);
      }
    });
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
      source: "window.__errs=[];window.addEventListener('error',function(e){window.__errs.push(String(e.message));});window.addEventListener('unhandledrejection',function(e){window.__errs.push(String(e.reason));});"
    });
    const lines = [];
    for (const view of [{ mode: "desktop", width: 1280, height: 900, mobile: false }, { mode: "mobile", width: 390, height: 844, mobile: true }]) {
      await loadAt(cdp, view.width, view.height, view.mobile);
      const batch = await withTimeout(cdp.send("Runtime.evaluate", {
        expression: "(" + audit.toString() + ")(" + JSON.stringify(view.mode) + ")",
        returnByValue: true,
        awaitPromise: true
      }), 60000, "audit " + view.mode);
      if (batch.exceptionDetails) {
        failed = true;
        console.log("FAIL audit " + view.mode + " -- " + (batch.exceptionDetails.text || "") + " " + ((batch.exceptionDetails.exception && batch.exceptionDetails.exception.description) || ""));
        continue;
      }
      for (const line of batch.result.value) {
        console.log("[" + view.width + "] " + line);
        lines.push(line);
      }
      if (view.mode === "mobile" && !batch.result.value.some((line) => line.startsWith("FAIL"))) {
        const dir = "/opt/cursor/artifacts/screenshots";
        await saveMobileShots(cdp, dir);
      }
    }
    if (runtimeErrors.length) {
      failed = true;
      console.log("FAIL runtime exceptions -- " + runtimeErrors.slice(0, 6).join(" | "));
    }
    const fails = lines.filter((line) => line.startsWith("FAIL"));
    const passes = lines.filter((line) => line.startsWith("PASS"));
    console.log(passes.length + " passed, " + (fails.length + (runtimeErrors.length ? 1 : 0)) + " failed");
    if (fails.length || runtimeErrors.length) failed = true;
    ws.close();
  } finally {
    chrome.kill("SIGKILL");
  }
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error("FAIL harness -- " + err.message);
  process.exit(1);
});
