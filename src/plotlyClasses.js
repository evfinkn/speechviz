// This would normally be in graphicalClasses.js, but it
// makes webpacking slower and makes the webpage take up
// more space, and we're not using it currently, so
// it doesn't make sense to include it yet.

import * as Plotly from "plotly.js-gl2d-dist";
import globals from "./globals.js";
import { getRandomColor } from "./util";

const media = globals.media;

var TimeSeries = class TimeSeries {
  /**
   * The div element containing the plot.
   * @type {!Element}
   */
  container;

  /**
   *
   * @type {!Array.<<number>}
   */
  x;

  /**
   *
   * @type {!Array.<Array.<<number>>}
   */
  ys;

  constructor(container, data) {
    this.container = container;
    this.x = [];
    this.ys = [];
    this.parseData(data);
    this.init();
  }

  parseData(data) {
    if (!data.length >= 2) {
      throw new Error("data must have at least 2 columns");
    }

    const x = [];
    const ys = [];
    for (let i = 1; i < data?.[0]?.length; i++) {
      ys.push([]);
    }
    for (const row of data) {
      x.push(row[0]);
      row.slice(1).forEach((y, i) => ys[i].push(y));
    }
    if (!ys.every((y) => y.length === x.length)) {
      throw new Error("Not every column has the same length.");
    }

    this.x = x;
    this.ys = ys;
  }

  init() {
    this.timelineX = [0, 0];
    this.timelineY = [0, 0];
    const data = [
      {
        type: "scattergl",
        mode: "lines",
        x: this.timelineX,
        y: this.timelineY,
        line: {
          color: "#000000",
        },
      },
    ];
    this.ys.forEach((y, i) =>
      data.push({
        type: "scattergl",
        mode: "lines",
        name: `y${i}`,
        x: this.x,
        y: y,
        line: { color: getRandomColor() },
      })
    );
    Plotly.newPlot(this.container, data, {}, { staticPlot: true });
    const [ymin, ymax] = this.container.layout.yaxis.range;
    Plotly.relayout(this.container, {
      "yaxis.autorange": false,
    });
    Plotly.restyle(
      this.container,
      {
        y: [[ymin, ymax]],
      },
      [0]
    );
    this.animate();
  }

  animate() {
    const time = media.currentTime;
    Plotly.restyle(
      this.container,
      {
        x: [[time, time]],
      },
      [0]
    );
    window.requestAnimationFrame(() => this.animate());
  }
};

export { TimeSeries };
