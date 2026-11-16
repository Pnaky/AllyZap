// Content script (část AlzaPriceTracker): Graf a tabulka historie cen (dialog historie).
// Načítá se po content.js a před content/start.js (manifest) – metody sdílí objekt AlzaPriceTracker
Object.assign(AlzaPriceTracker, {
  // Schodový graf: cena platí až do další zjištěné změny (skok se kreslí v čase kontroly, která ji zachytila).
  // Historické minimum a prodejní maximum se kreslí jako vodorovné milníky přes celý graf
  // (ceníkové maximum ne – to je obvykle samotná čára původní ceny), stejně tak cílová cena.
  // Přiblížení časové osy: tažením myší (výběr úseku), Ctrl/⌘ + kolečko nebo sevření prstů na touchpadu,
  // posun Shift + kolečkem (nebo vodorovným tahem), dvojklik a „Vše“ vrátí celé období; nad grafem
  // rychlé volby posledních 24 h / 7 / 30 dní. Osa Y zůstává pro celou historii (milníky se nemění).
  // Díra ve sledování (AlzaCore.getHistoryGaps – cenu nikdo neviděl déle než priceGapDays): čára přes ni nevede,
  // místo ní je šrafovaný pás „nesledováno“ a bublina říká, že cena nebyla sledována
  createHistoryChart(entries, productData, target) {
    const W = 800;
    const H = 300;
    const m = { l: 76, r: 16, t: 12, b: 28 };
    const bandH = 8;
    const plotBottom = H - m.b - bandH - 8;
    const bandY = plotBottom + 6;
    const plotW = W - m.l - m.r;
    const types = this.getHistoryTypes(entries);
    const gaps = AlzaCore.getHistoryGaps(entries);
    const HOUR = 60 * 60 * 1000;
    const DAY = 24 * HOUR;
    const minSpan = 15 * 60 * 1000;

    let full0 = entries[0].t;
    let full1 = entries[entries.length - 1].s;
    if (full1 - full0 < HOUR) {
      full0 -= 12 * HOUR;
      full1 += 12 * HOUR;
    }
    const view = { t0: full0, t1: full1 };

    const milestones = [
      { key: "min", label: "Min", data: this.getHistoricExtreme(entries, productData?.minPrice, "min") },
      { key: "max", label: this.translate("milestoneSellingMax"), data: this.getSellingMax(entries, productData) },
    ].filter(({ data }) => typeof data?.value === "number");

    const values = [
      ...entries.flatMap((entry) => Object.values(entry.p)),
      ...milestones.map(({ data }) => data.value),
      ...(target ? [target.price] : []),
    ];
    const vMin = Math.min(...values);
    const vMax = Math.max(...values);
    const span = vMax - vMin || vMax * 0.1 || 1;
    const rough = span / 4;
    const pow = 10 ** Math.floor(Math.log10(rough));
    const step = [1, 2, 2.5, 5, 10].find((f) => f * pow >= rough) * pow;
    // Dole víc místa – popisek Min je pod čarou
    const yLo = Math.max(0, Math.floor((vMin - span * 0.1) / step) * step);
    const yHi = Math.ceil((vMax + span * 0.05) / step) * step;

    const x = (t) => m.l + ((t - view.t0) / (view.t1 - view.t0)) * plotW;
    const y = (v) => m.t + ((yHi - v) / (yHi - yLo)) * (plotBottom - m.t);
    const timeAt = (px) => view.t0 + ((px - m.l) / plotW) * (view.t1 - view.t0);

    const svg = this.createSvgEl("svg", { viewBox: `0 0 ${W} ${H}`, role: "img" });
    // Čáry a pás dostupnosti mimo zobrazený úsek ořízne clipPath (o kus širší – body na okraji celé)
    this.state.historyChartCount = (this.state.historyChartCount || 0) + 1;
    const clipId = `alza-price-tracker-history-clip-${this.state.historyChartCount}`;
    const defs = this.createSvgEl("defs");
    const clipPath = this.createSvgEl("clipPath", { id: clipId });
    clipPath.appendChild(this.createSvgEl("rect", { x: m.l - 4, y: 0, width: plotW + 8, height: H }));
    defs.appendChild(clipPath);
    // Šrafování pásu „nesledováno“
    const hatchId = `alza-price-tracker-history-hatch-${this.state.historyChartCount}`;
    const hatch = this.createSvgEl("pattern", { id: hatchId, width: 7, height: 7, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" });
    hatch.appendChild(this.createSvgEl("rect", { width: 7, height: 7, class: "alza-price-tracker-history-gap-bg" }));
    hatch.appendChild(this.createSvgEl("line", { x1: 0, y1: 0, x2: 0, y2: 7, class: "alza-price-tracker-history-gap-hatch" }));
    defs.appendChild(hatch);
    svg.appendChild(defs);

    // Osa Y – mřížka a popisky
    const axisDigits = step < 1 ? 2 : 0;
    for (let v = yLo; v <= yHi + step / 2; v += step) {
      svg.appendChild(
        this.createSvgEl("line", { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: "alza-price-tracker-history-grid" })
      );
      const label = this.createSvgEl("text", { x: m.l - 8, y: y(v) + 4, "text-anchor": "end" });
      label.textContent = `${v.toLocaleString(this.state.locale, {
        minimumFractionDigits: axisDigits,
        maximumFractionDigits: axisDigits,
      })} ${this.state.currencySymbol}`;
      svg.appendChild(label);
    }

    // Milníky Min/Max – popisek vlevo (vpravo přibývají nové hodnoty), Max nad čarou, Min pod ní
    milestones.forEach(({ key, label, data }) => {
      const color = this.config.historyMilestoneColors[key];
      svg.appendChild(
        this.createSvgEl("line", {
          x1: m.l,
          x2: W - m.r,
          y1: y(data.value),
          y2: y(data.value),
          stroke: color,
          class: "alza-price-tracker-history-milestone",
        })
      );
      const text = this.createSvgEl("text", {
        x: m.l + 4,
        y: y(data.value) + (key === "min" ? 14 : -5),
        "text-anchor": "start",
        class: "alza-price-tracker-history-milestone-label",
      });
      text.style.fill = color;
      const date = new Date(data.timestamp).toLocaleDateString(this.state.locale);
      text.textContent = `${label} ${this.formatPrice(data.value)} (${date})`;
      svg.appendChild(text);
    });

    if (target) {
      const color = this.config.historyMilestoneColors.target;
      svg.appendChild(
        this.createSvgEl("line", {
          x1: m.l,
          x2: W - m.r,
          y1: y(target.price),
          y2: y(target.price),
          stroke: color,
          class: "alza-price-tracker-history-milestone",
        })
      );
      const text = this.createSvgEl("text", {
        x: m.l + 4,
        y: y(target.price) - 5,
        "text-anchor": "start",
        class: "alza-price-tracker-history-milestone-label",
      });
      text.style.fill = color;
      text.textContent = `${this.translate("milestoneTarget")} ${this.formatPrice(target.price)}`;
      svg.appendChild(text);
    }

    // Osa X a data se překreslují při každé změně zobrazeného úseku; mřížka, osa Y a milníky zůstávají
    const xAxis = this.createSvgEl("g");
    const data = this.createSvgEl("g", { "clip-path": `url(#${clipId})` });
    svg.append(xAxis, data);

    // Hover – svislá čára + tooltip se stavem v daném okamžiku; tažením se vybírá úsek k přiblížení
    const cursor = this.createSvgEl("line", {
      y1: m.t,
      y2: bandY + bandH,
      class: "alza-price-tracker-history-cursor",
      visibility: "hidden",
    });
    const selection = this.createSvgEl("rect", {
      y: m.t,
      height: bandY + bandH - m.t,
      class: "alza-price-tracker-history-selection",
      visibility: "hidden",
    });
    const overlay = this.createSvgEl("rect", {
      x: m.l,
      y: m.t,
      width: plotW,
      height: bandY + bandH - m.t,
      fill: "transparent",
      class: "alza-price-tracker-history-overlay",
    });
    svg.append(selection, cursor, overlay);

    const box = this.createEl("div", "alza-price-tracker-history-chart-box");
    const toolbar = this.createEl("div", "alza-price-tracker-history-zoom");
    const wrap = this.createEl("div", "alza-price-tracker-history-chart");
    const tooltip = this.createEl("div", "alza-price-tracker-history-tooltip");
    wrap.append(svg, tooltip);
    box.append(toolbar, wrap);

    // Rychlé volby – jen kratší než celá historie; „Vše“ vždy
    const fullSpan = full1 - full0;
    const isZoomed = () => view.t0 > full0 || view.t1 < full1;
    const presets = [
      { key: "zoom24h", span: DAY },
      { key: "zoom7d", span: 7 * DAY },
      { key: "zoom30d", span: 30 * DAY },
    ].filter(({ span }) => span < fullSpan * 0.9);
    const zoomButtons = [...presets, { key: "zoomAll", span: fullSpan }].map((preset) => {
      const button = this.createEl("button", "alza-price-tracker-history-zoom-button", this.translate(preset.key));
      button.type = "button";
      button.addEventListener("click", () => setView(full1 - preset.span, full1));
      return { button, preset };
    });
    toolbar.append(
      ...zoomButtons.map(({ button }) => button),
      this.createEl("span", "alza-price-tracker-history-zoom-hint", this.translate("zoomHint"))
    );

    const render = () => {
      xAxis.textContent = "";
      data.textContent = "";

      // Osa X – 5 popisků, u krátkého úseku i s časem
      const dateFormat =
        view.t1 - view.t0 > 3 * DAY
          ? { day: "numeric", month: "numeric" }
          : { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" };
      for (let i = 0; i <= 4; i++) {
        const t = view.t0 + ((view.t1 - view.t0) * i) / 4;
        const anchor = i === 0 ? "start" : i === 4 ? "end" : "middle";
        const label = this.createSvgEl("text", { x: x(t), y: H - 6, "text-anchor": anchor });
        label.textContent = new Date(t).toLocaleString(this.state.locale, dateFormat);
        xAxis.appendChild(label);
      }

      // Díry ve sledování – šrafovaný pás přes celou výšku grafu; popisek uprostřed viditelné části, když se vejde
      gaps.forEach(({ from, to }) => {
        data.appendChild(
          this.createSvgEl("rect", { x: x(from), y: m.t, width: x(to) - x(from), height: bandY + bandH - m.t, fill: `url(#${hatchId})`, class: "alza-price-tracker-history-gap" })
        );
        const left = Math.max(x(from), m.l);
        const right = Math.min(x(to), m.l + plotW);
        if (right - left < 96) return;
        const label = this.createSvgEl("text", { x: (left + right) / 2, y: m.t + 14, "text-anchor": "middle", class: "alza-price-tracker-history-gap-label" });
        label.textContent = this.translate("historyGapLabel");
        data.appendChild(label);
      });

      // Pás dostupnosti pod grafem – jen po dobu, kdy záznam platí (AlzaCore.getEntryEnd)
      entries.forEach((entry, i) => {
        if (entry.a === null) return;
        const x1 = x(entry.t);
        const x2 = x(AlzaCore.getEntryEnd(entries, i));
        data.appendChild(
          this.createSvgEl("rect", {
            x: x1,
            y: bandY,
            width: Math.max(2, x2 - x1),
            height: bandH,
            rx: 2,
            fill: this.getAvailabilityColor(entry.a),
          })
        );
      });

      // Čáry jednotlivých typů cen
      types.forEach((type) => {
        const color = this.getHistoryColor(type);
        const path = [];

        entries.forEach((entry, i) => {
          const v = entry.p[type];
          if (v === undefined) return;
          const next = entries[i + 1];
          const nextV = next?.p[type];
          // Čára jen po dobu známé ceny; přes díru ve sledování nevede a další záznam začíná bez svislého skoku
          const end = AlzaCore.getEntryEnd(entries, i);
          path.push(`M${x(entry.t)},${y(v)}H${x(end)}`);
          if (nextV !== undefined && !(next.t > end)) path.push(`V${y(nextV)}`);
        });

        data.appendChild(this.createSvgEl("path", { d: path.join(""), stroke: color, class: "alza-price-tracker-history-line" }));

        // Body v místech změny a tam, kde sledování po díře znovu začíná (i stejnou cenou)
        entries.forEach((entry, i) => {
          const v = entry.p[type];
          if (v === undefined || (i > 0 && entries[i - 1].p[type] === v && !(entry.t > AlzaCore.getEntryEnd(entries, i - 1)))) return;
          data.appendChild(this.createSvgEl("circle", { cx: x(entry.t), cy: y(v), r: 3, fill: color }));
        });
      });

      const zoomed = isZoomed();
      zoomButtons.forEach(({ button, preset }) => {
        const active = preset.key === "zoomAll" ? !zoomed : view.t1 === full1 && view.t1 - view.t0 === preset.span;
        button.classList.toggle("alza-price-tracker-history-zoom-button--active", active);
        button.setAttribute("aria-pressed", String(active));
      });
    };

    // Nový úsek – nejméně 15 min, nikdy mimo historii (přesah se posune dovnitř)
    const setView = (t0, t1) => {
      const span = Math.max(minSpan, t1 - t0);
      if (span >= fullSpan) {
        view.t0 = full0;
        view.t1 = full1;
      } else {
        const start = Math.min(Math.max((t0 + t1) / 2 - span / 2, full0), full1 - span);
        view.t0 = start;
        view.t1 = start + span;
      }
      render();
    };

    const pointerX = (event) => {
      const svgRect = svg.getBoundingClientRect();
      const px = ((event.clientX - svgRect.left) / svgRect.width) * W;
      return Math.min(Math.max(px, m.l), m.l + plotW);
    };

    let dragStart = null;
    const showSelection = (px) => {
      selection.setAttribute("x", Math.min(dragStart, px));
      selection.setAttribute("width", Math.abs(px - dragStart));
      selection.setAttribute("visibility", "visible");
    };

    overlay.addEventListener("mousemove", (event) => {
      const px = pointerX(event);
      cursor.setAttribute("x1", px);
      cursor.setAttribute("x2", px);
      cursor.setAttribute("visibility", "visible");

      if (dragStart !== null) {
        tooltip.style.display = "none";
        return;
      }

      const t = timeAt(px);
      let index = 0;
      entries.forEach((entry, i) => {
        if (entry.t <= t) index = i;
      });
      const gap = gaps.find(({ from, to }) => t >= from && t < to);
      if (gap) this.fillHistoryGapTooltip(tooltip, gap);
      else this.fillHistoryTooltip(tooltip, entries[index], types);
      tooltip.style.display = "block";
      const wrapRect = wrap.getBoundingClientRect();
      let left = event.clientX - wrapRect.left + 14;
      if (left + tooltip.offsetWidth > wrapRect.width) left -= tooltip.offsetWidth + 28;
      tooltip.style.left = `${Math.max(0, left)}px`;
    });
    overlay.addEventListener("mouseleave", () => {
      cursor.setAttribute("visibility", "hidden");
      tooltip.style.display = "none";
    });

    // Výběr úseku tažením – puštění i mimo graf (posluchač na okně); krátký tah (klik) nic nemění
    overlay.addEventListener("mousedown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      dragStart = pointerX(event);
      const onMove = (moveEvent) => showSelection(pointerX(moveEvent));
      const onUp = (upEvent) => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        const start = dragStart;
        const end = pointerX(upEvent);
        dragStart = null;
        selection.setAttribute("visibility", "hidden");
        if (Math.abs(end - start) >= 6) setView(timeAt(Math.min(start, end)), timeAt(Math.max(start, end)));
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    });
    overlay.addEventListener("dblclick", () => setView(full0, full1));

    // Ctrl/⌘ + kolečko (i sevření prstů na touchpadu) přibližuje kolem kurzoru; Shift + kolečko nebo
    // vodorovný tah posouvá přiblížený graf. Samotné kolečko dál posouvá dialog
    overlay.addEventListener(
      "wheel",
      (event) => {
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          const anchor = timeAt(pointerX(event));
          const factor = Math.exp(Math.max(-1, Math.min(1, event.deltaY * 0.01)) * 0.5);
          const t0 = anchor - (anchor - view.t0) * factor;
          const t1 = anchor + (view.t1 - anchor) * factor;
          // setView úsek vystředí – dokud se vejde, nastaví se přímo, ať místo pod kurzorem zůstane na místě
          if (t1 - t0 >= minSpan && t1 - t0 < fullSpan && t0 >= full0 && t1 <= full1) {
            view.t0 = t0;
            view.t1 = t1;
            render();
          } else {
            setView(t0, t1);
          }
        } else if (isZoomed() && (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY))) {
          event.preventDefault();
          const delta = event.deltaX || event.deltaY;
          const shift = (delta / plotW) * (view.t1 - view.t0);
          setView(view.t0 + shift, view.t1 + shift);
        }
      },
      { passive: false }
    );

    render();
    return box;
  },

  fillHistoryTooltip(tooltip, entry, types) {
    tooltip.textContent = "";
    const range =
      entry.t === entry.s
        ? this.formatDateTime(entry.t)
        : `${this.formatDateTime(entry.t)} – ${this.formatDateTime(entry.s)}`;
    tooltip.appendChild(this.createEl("div", "alza-price-tracker-history-tooltip-date", range));

    types.forEach((type) => {
      if (entry.p[type] === undefined) return;
      const row = this.createEl("div", "alza-price-tracker-history-tooltip-row");
      const swatch = this.createEl("span", "alza-price-tracker-history-swatch");
      swatch.style.background = this.getHistoryColor(type);
      row.append(
        swatch,
        this.createEl("span", null, this.translate(`type_${type}`)),
        this.createEl("strong", null, this.formatPrice(entry.p[type]))
      );
      tooltip.appendChild(row);
    });

    if (entry.a !== null) {
      const row = this.createEl("div", "alza-price-tracker-history-tooltip-row");
      const swatch = this.createEl("span", "alza-price-tracker-history-swatch alza-price-tracker-history-swatch-band");
      swatch.style.background = this.getAvailabilityColor(entry.a);
      row.append(swatch, this.createEl("span", null, this.getAvailabilityLabel(entry.a)));
      tooltip.appendChild(row);
    }
  },

  // Bublina nad dírou ve sledování: od kdy do kdy cenu nikdo neviděl
  fillHistoryGapTooltip(tooltip, gap) {
    tooltip.textContent = "";
    tooltip.appendChild(this.createEl("div", "alza-price-tracker-history-tooltip-date", `${this.formatDateTime(gap.from)} – ${this.formatDateTime(gap.to)}`));
    tooltip.appendChild(this.createEl("div", "alza-price-tracker-history-tooltip-row", this.translate("historyGapTooltip")));
  },

  // Tabulka změn – nejnovější nahoře, změněné hodnoty zvýrazněné šipkou; mezi záznamy oddělenými dírou ve sledování
  // (AlzaCore.getHistoryGaps) je řádek „Nesledováno od – do“
  createHistoryTable(entries) {
    const types = this.getHistoryTypes(entries);
    const gaps = AlzaCore.getHistoryGaps(entries);
    const wrap = this.createEl("div", "alza-price-tracker-history-table-wrap");
    const table = this.createEl("table", "alza-price-tracker-history-table");

    const headRow = document.createElement("tr");
    [
      this.translate("colFrom"),
      this.translate("colTo"),
      ...types.map((type) => this.translate(`type_${type}`)),
      this.translate("colAvailability"),
    ].forEach((label) => headRow.appendChild(this.createEl("th", null, label)));
    table.createTHead().appendChild(headRow);

    const tbody = table.createTBody();
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i];
      const prev = entries[i - 1];
      const row = tbody.insertRow();

      row.appendChild(this.createEl("td", null, this.formatDateTime(entry.t)));
      row.appendChild(this.createEl("td", null, this.formatDateTime(entry.s)));

      types.forEach((type) => {
        const v = entry.p[type];
        const prevV = prev?.p[type];
        const cell = this.createEl("td");
        if (v === undefined) {
          cell.textContent = "–";
        } else {
          let prefix = "";
          const tooltip = [];
          if (prevV !== undefined && v !== prevV) {
            cell.className = v > prevV ? "alza-price-tracker-history-up" : "alza-price-tracker-history-down";
            prefix = v > prevV ? "▲ " : "▼ ";
            tooltip.push(this.getPriceChangeText(prevV, v));
          }
          // Sleva oproti vyšším cenám ve stejném řádku (jako tooltip v přehledu)
          types
            .filter((other) => entry.p[other] > v)
            .forEach((other) =>
              tooltip.push(`${this.translate(`type_${other}`)}: ${this.getDiscountText(entry.p[other], v)}`)
            );
          if (tooltip.length > 0) cell.title = tooltip.join("\n");
          cell.textContent = `${prefix}${this.formatPrice(v)}`;
        }
        row.appendChild(cell);
      });

      const availabilityCell = this.createEl("td", null, this.getAvailabilityLabel(entry.a));
      if (prev && prev.a !== null && entry.a !== null && prev.a !== entry.a) {
        availabilityCell.title = this.translate("availabilityChangedFrom", this.getAvailabilityLabel(prev.a));
      }
      row.appendChild(availabilityCell);

      const gap = gaps.find(({ index }) => index === i - 1);
      if (gap) {
        const days = Math.round((gap.to - gap.from) / AlzaCore.dayMs);
        const range = this.translate("historyGapRow", this.formatDateTime(gap.from), this.formatDateTime(gap.to));
        const gapCell = this.createEl("td", null, days >= 1 ? `${range} (${this.formatDays(days)})` : range);
        gapCell.colSpan = types.length + 3;
        const gapRow = tbody.insertRow();
        gapRow.className = "alza-price-tracker-history-gap-row";
        gapRow.appendChild(gapCell);
      }
    }

    wrap.appendChild(table);
    return wrap;
  },
});
