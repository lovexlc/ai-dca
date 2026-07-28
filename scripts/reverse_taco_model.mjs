#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const SCORE_SCALE_Z = 2.9;
const DEFAULT_CUTOFF = "2026-02-28";

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = value;
      index += 1;
    }
  }
  return args;
}

function extractScores(html) {
  const pattern = /\\"date\\":\\"(\d{4}-\d{2}-\d{2})\\",\\"score\\":(\d+)/g;
  const rows = [...html.matchAll(pattern)].map((match) => ({
    date: match[1],
    score: Number(match[2]),
  }));

  if (rows.length === 0) {
    throw new Error("No TACO score series was found in the supplied HTML.");
  }

  const unique = new Map();
  for (const row of rows) {
    if (unique.has(row.date) && unique.get(row.date) !== row.score) {
      throw new Error(`Conflicting scores found for ${row.date}.`);
    }
    unique.set(row.date, row.score);
  }

  return [...unique.entries()]
    .map(([date, score]) => ({ date, score }))
    .sort((left, right) => left.date.localeCompare(right.date));
}

function validateDailySeries(rows) {
  for (let index = 1; index < rows.length; index += 1) {
    const previous = new Date(`${rows[index - 1].date}T00:00:00Z`);
    const expected = new Date(previous);
    expected.setUTCDate(expected.getUTCDate() + 1);
    const expectedDate = expected.toISOString().slice(0, 10);
    if (rows[index].date !== expectedDate) {
      throw new Error(
        `Series is not daily: expected ${expectedDate}, found ${rows[index].date}.`,
      );
    }
  }
}

function parseCsv(filePath) {
  const [headerLine, ...lines] = fs
    .readFileSync(filePath, "utf8")
    .trim()
    .split(/\r?\n/);
  const headers = headerLine.split(",");
  const rows = new Map();

  for (const line of lines) {
    const values = line.split(",");
    const row = {};
    for (let index = 1; index < headers.length; index += 1) {
      const value = values[index];
      row[headers[index]] =
        value && value !== "." && Number.isFinite(Number(value))
          ? Number(value)
          : null;
    }
    rows.set(values[0], row);
  }

  return rows;
}

function parsePortwatchJson(filePaths) {
  const rows = new Map();
  for (const filePath of filePaths) {
    const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
    for (const feature of payload.features ?? []) {
      const attributes = feature.attributes ?? {};
      if (!attributes.date) continue;
      rows.set(attributes.date, {
        tanker: attributes.n_tanker,
        total: attributes.n_total,
      });
    }
  }
  return rows;
}

function dateRange(startDate, endDate) {
  const dates = [];
  const cursor = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function joinMarketData(scores, dailyRows, sp500Rows, portwatchRows = new Map()) {
  const earliestMarketDate = [...sp500Rows.keys()].sort()[0];
  const startDate =
    earliestMarketDate < scores[0].date ? earliestMarketDate : scores[0].date;
  const allDates = dateRange(startDate, scores.at(-1).date);
  const scoreMap = new Map(scores.map((row) => [row.date, row.score]));
  const last = {};

  return allDates.map((date) => {
    const daily = dailyRows.get(date) ?? {};
    const sp500 = sp500Rows.get(date) ?? {};
    const portwatch = portwatchRows.get(date) ?? {};
    for (const key of ["DCOILBRENTEU", "DGS10"]) {
      if (Number.isFinite(daily[key])) last[key] = daily[key];
    }
    if (Number.isFinite(sp500.SP500)) last.SP500 = sp500.SP500;

    return {
      date,
      score: scoreMap.get(date),
      brent: last.DCOILBRENTEU,
      tnx: last.DGS10,
      sp500: last.SP500,
      hormuzTanker: portwatch.tanker,
      hormuzTotal: portwatch.total,
    };
  });
}

function rollingZ(rows, key, windowDays) {
  const result = new Array(rows.length).fill(null);
  const values = rows.map((row) => row[key]);
  let sum = 0;
  let sumSquares = 0;
  let count = 0;

  for (let index = 0; index < rows.length; index += 1) {
    const value = values[index];
    if (Number.isFinite(value)) {
      sum += value;
      sumSquares += value * value;
      count += 1;
    }

    const removedIndex = index - windowDays;
    if (removedIndex >= 0 && Number.isFinite(values[removedIndex])) {
      const removed = values[removedIndex];
      sum -= removed;
      sumSquares -= removed * removed;
      count -= 1;
    }

    if (count < Math.max(20, Math.floor(windowDays * 0.8))) continue;
    const mean = sum / count;
    const variance = Math.max(0, sumSquares / count - mean * mean);
    const standardDeviation = Math.sqrt(variance);
    if (standardDeviation > 0) {
      result[index] = (value - mean) / standardDeviation;
    }
  }

  return result;
}

function solveLinearSystem(matrix, vector) {
  const size = vector.length;
  const a = matrix.map((row) => [...row]);
  const b = [...vector];

  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(a[row][column]) > Math.abs(a[pivot][column])) pivot = row;
    }
    if (Math.abs(a[pivot][column]) < 1e-12) return null;
    [a[column], a[pivot]] = [a[pivot], a[column]];
    [b[column], b[pivot]] = [b[pivot], b[column]];

    const divisor = a[column][column];
    for (let index = column; index < size; index += 1) {
      a[column][index] /= divisor;
    }
    b[column] /= divisor;

    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const multiplier = a[row][column];
      for (let index = column; index < size; index += 1) {
        a[row][index] -= multiplier * a[column][index];
      }
      b[row] -= multiplier * b[column];
    }
  }

  return b;
}

function ordinaryLeastSquares(rows, targetKey, featureKeys) {
  const size = featureKeys.length + 1;
  const matrix = Array.from({ length: size }, () => Array(size).fill(0));
  const vector = Array(size).fill(0);

  for (const row of rows) {
    const features = [1, ...featureKeys.map((key) => row[key])];
    const target = row[targetKey];
    for (let left = 0; left < size; left += 1) {
      vector[left] += features[left] * target;
      for (let right = 0; right < size; right += 1) {
        matrix[left][right] += features[left] * features[right];
      }
    }
  }

  return solveLinearSystem(matrix, vector);
}

function scoreFromComposite(composite) {
  return Math.max(
    0,
    Math.min(100, Math.round((composite / SCORE_SCALE_Z) * 100)),
  );
}

function evaluateModel(rows, coefficients, featureKeys) {
  let squaredError = 0;
  let absoluteError = 0;
  let exact = 0;
  let withinOne = 0;
  let withinTwo = 0;
  let withinThree = 0;
  const mean = rows.reduce((sum, row) => sum + row.score, 0) / rows.length;
  let totalSquaredError = 0;

  for (const row of rows) {
    const composite = featureKeys.reduce(
      (value, key, index) => value + coefficients[index + 1] * row[key],
      coefficients[0],
    );
    const prediction = scoreFromComposite(composite);
    const error = prediction - row.score;
    squaredError += error * error;
    absoluteError += Math.abs(error);
    if (error === 0) exact += 1;
    if (Math.abs(error) <= 1) withinOne += 1;
    if (Math.abs(error) <= 2) withinTwo += 1;
    if (Math.abs(error) <= 3) withinThree += 1;
    totalSquaredError += (row.score - mean) ** 2;
  }

  return {
    n: rows.length,
    rmse: Math.sqrt(squaredError / rows.length),
    mae: absoluteError / rows.length,
    exact,
    exactRate: exact / rows.length,
    withinOneRate: withinOne / rows.length,
    withinTwoRate: withinTwo / rows.length,
    withinThreeRate: withinThree / rows.length,
    rSquared: totalSquaredError > 0 ? 1 - squaredError / totalSquaredError : null,
  };
}

function fitRollingCandidates(joinedRows, cutoffDate) {
  const windows = [20, 30, 60, 90, 126, 180, 252, 365, 504, 730, 1260, 1825];
  const results = [];

  for (const windowDays of windows) {
    const brentZ = rollingZ(joinedRows, "brent", windowDays);
    const tnxZ = rollingZ(joinedRows, "tnx", windowDays);
    const sp500Z = rollingZ(joinedRows, "sp500", windowDays);
    const modeledRows = joinedRows
      .map((row, index) => ({
        ...row,
        targetComposite: (row.score * SCORE_SCALE_Z) / 100,
        brentZ: brentZ[index],
        tnxZ: tnxZ[index],
        inverseSp500Z: Number.isFinite(sp500Z[index]) ? -sp500Z[index] : null,
      }))
      .filter(
        (row) =>
          row.date <= cutoffDate &&
          Number.isFinite(row.score) &&
          ["brentZ", "tnxZ", "inverseSp500Z"].every((key) =>
            Number.isFinite(row[key]),
          ),
      );

    const positiveRows = modeledRows.filter((row) => row.score > 0);
    const featureKeys = ["brentZ", "tnxZ", "inverseSp500Z"];
    const coefficients = ordinaryLeastSquares(
      positiveRows,
      "targetComposite",
      featureKeys,
    );
    if (!coefficients) continue;
    results.push({
      windowDays,
      coefficients,
      positiveFit: evaluateModel(positiveRows, coefficients, featureKeys),
      allRowsFit: evaluateModel(modeledRows, coefficients, featureKeys),
    });
  }

  return results.sort((left, right) => left.allRowsFit.rmse - right.allRowsFit.rmse);
}

function fitRawLevelCandidates(joinedRows, cutoffDate, startDate) {
  const specifications = [
    {
      name: "market-only",
      featureKeys: ["brent", "tnx", "inverseSp500"],
    },
    {
      name: "hormuz-tanker",
      featureKeys: ["brent", "tnx", "inverseSp500", "inverseHormuzTanker"],
    },
    {
      name: "hormuz-total",
      featureKeys: ["brent", "tnx", "inverseSp500", "inverseHormuzTotal"],
    },
  ];

  return specifications.map((specification) => {
    const modeledRows = joinedRows
      .map((row) => ({
        ...row,
        targetComposite: (row.score * SCORE_SCALE_Z) / 100,
        inverseSp500: Number.isFinite(row.sp500) ? -row.sp500 : null,
        inverseHormuzTanker: Number.isFinite(row.hormuzTanker)
          ? -row.hormuzTanker
          : null,
        inverseHormuzTotal: Number.isFinite(row.hormuzTotal)
          ? -row.hormuzTotal
          : null,
      }))
      .filter(
        (row) =>
          row.date <= cutoffDate &&
          (!startDate || row.date >= startDate) &&
          Number.isFinite(row.score) &&
          specification.featureKeys.every((key) => Number.isFinite(row[key])),
      );
    const positiveRows = modeledRows.filter((row) => row.score > 0);
    const coefficients = ordinaryLeastSquares(
      positiveRows,
      "targetComposite",
      specification.featureKeys,
    );
    return {
      name: specification.name,
      featureKeys: specification.featureKeys,
      coefficients,
      positiveFit: evaluateModel(
        positiveRows,
        coefficients,
        specification.featureKeys,
      ),
      allRowsFit: evaluateModel(
        modeledRows,
        coefficients,
        specification.featureKeys,
      ),
    };
  });
}

function fitTemporalValidation(joinedRows) {
  const featureKeys = [
    "brent",
    "tnx",
    "inverseSp500",
    "inverseHormuzTotal",
  ];
  const preparedRows = joinedRows
    .map((row) => ({
      ...row,
      targetComposite: (row.score * SCORE_SCALE_Z) / 100,
      inverseSp500: Number.isFinite(row.sp500) ? -row.sp500 : null,
      inverseHormuzTotal: Number.isFinite(row.hormuzTotal)
        ? -row.hormuzTotal
        : null,
    }))
    .filter(
      (row) =>
        Number.isFinite(row.score) &&
        featureKeys.every((key) => Number.isFinite(row[key])),
    );
  const trainingRows = preparedRows.filter(
    (row) =>
      row.date >= "2025-01-01" &&
      row.date <= "2025-12-31" &&
      row.score > 0,
  );
  const validationRows = preparedRows.filter(
    (row) => row.date >= "2026-01-01" && row.date <= "2026-02-27",
  );
  const coefficients = ordinaryLeastSquares(
    trainingRows,
    "targetComposite",
    featureKeys,
  );

  return {
    trainingWindow: ["2025-01-01", "2025-12-31"],
    validationWindow: ["2026-01-01", "2026-02-27"],
    coefficients,
    scoreCoefficients: coefficients.map(
      (coefficient) => coefficient * (100 / SCORE_SCALE_Z),
    ),
    validationFit: evaluateModel(validationRows, coefficients, featureKeys),
  };
}

function laggedChange(values, lagDays, mode) {
  return values.map((value, index) => {
    const previous = values[index - lagDays];
    if (!Number.isFinite(value) || !Number.isFinite(previous)) return null;
    if (mode === "difference") return value - previous;
    if (value <= 0 || previous <= 0) return null;
    return Math.log(value / previous);
  });
}

function fitLaggedChangeCandidates(joinedRows, cutoffDate) {
  const lags = [1, 2, 3, 5, 7, 10, 14, 20, 30, 45, 60, 90, 126, 180, 252];
  const results = [];

  for (const lagDays of lags) {
    const brentChange = laggedChange(
      joinedRows.map((row) => row.brent),
      lagDays,
      "log",
    );
    const tnxChange = laggedChange(
      joinedRows.map((row) => row.tnx),
      lagDays,
      "difference",
    );
    const sp500Change = laggedChange(
      joinedRows.map((row) => row.sp500),
      lagDays,
      "log",
    );
    const modeledRows = joinedRows
      .map((row, index) => ({
        ...row,
        targetComposite: (row.score * SCORE_SCALE_Z) / 100,
        brentChange: brentChange[index],
        tnxChange: tnxChange[index],
        inverseSp500Change: Number.isFinite(sp500Change[index])
          ? -sp500Change[index]
          : null,
      }))
      .filter(
        (row) =>
          row.date <= cutoffDate &&
          Number.isFinite(row.score) &&
          ["brentChange", "tnxChange", "inverseSp500Change"].every((key) =>
            Number.isFinite(row[key]),
          ),
      );

    const positiveRows = modeledRows.filter((row) => row.score > 0);
    const featureKeys = [
      "brentChange",
      "tnxChange",
      "inverseSp500Change",
    ];
    const coefficients = ordinaryLeastSquares(
      positiveRows,
      "targetComposite",
      featureKeys,
    );
    if (!coefficients) continue;
    results.push({
      lagDays,
      coefficients,
      positiveFit: evaluateModel(positiveRows, coefficients, featureKeys),
      allRowsFit: evaluateModel(modeledRows, coefficients, featureKeys),
    });
  }

  return results.sort((left, right) => left.allRowsFit.rmse - right.allRowsFit.rmse);
}

function writeScoresCsv(filePath, rows) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const body = ["date,score", ...rows.map((row) => `${row.date},${row.score}`)].join(
    "\n",
  );
  fs.writeFileSync(filePath, `${body}\n`);
}

function writeModelFitCsv(filePath, rows, coefficients, cutoffDate) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const header = [
    "date",
    "score",
    "brent",
    "tnx",
    "sp500",
    "hormuz_total",
    "predicted_score",
    "residual",
  ];
  const body = [header.join(",")];
  for (const row of rows) {
    if (
      row.date > cutoffDate ||
      !Number.isFinite(row.score) ||
      !["brent", "tnx", "sp500", "hormuzTotal"].every((key) =>
        Number.isFinite(row[key]),
      )
    ) {
      continue;
    }
    const composite =
      coefficients[0] +
      coefficients[1] * row.brent +
      coefficients[2] * row.tnx -
      coefficients[3] * row.sp500 -
      coefficients[4] * row.hormuzTotal;
    const predictedScore = scoreFromComposite(composite);
    body.push(
      [
        row.date,
        row.score,
        row.brent,
        row.tnx,
        row.sp500,
        row.hormuzTotal,
        predictedScore,
        predictedScore - row.score,
      ].join(","),
    );
  }
  fs.writeFileSync(filePath, `${body.join("\n")}\n`);
}

const args = parseArgs(process.argv.slice(2));
if (!args.html) {
  throw new Error(
    "Usage: node scripts/reverse_taco_model.mjs --html PAGE.html " +
      "[--out history.csv] [--fred-daily daily.csv --fred-sp500 sp500.csv " +
      "--hormuz-json page-0.json,page-1000.json,... --cutoff YYYY-MM-DD " +
      "--fit-out model-fit.csv]",
  );
}

const scores = extractScores(fs.readFileSync(args.html, "utf8"));
validateDailySeries(scores);
if (args.out) writeScoresCsv(args.out, scores);

const summary = {
  observations: scores.length,
  start: scores[0],
  end: scores.at(-1),
  minimum: Math.min(...scores.map((row) => row.score)),
  maximum: Math.max(...scores.map((row) => row.score)),
  zeroDays: scores.filter((row) => row.score === 0).length,
};
console.log(JSON.stringify(summary, null, 2));

if (args["fred-daily"] && args["fred-sp500"]) {
  const portwatchRows = args["hormuz-json"]
    ? parsePortwatchJson(args["hormuz-json"].split(","))
    : new Map();
  const joinedRows = joinMarketData(
    scores,
    parseCsv(args["fred-daily"]),
    parseCsv(args["fred-sp500"]),
    portwatchRows,
  );
  const rawLevelCandidates = fitRawLevelCandidates(
    joinedRows,
    args.cutoff ?? DEFAULT_CUTOFF,
    args["fit-start"],
  );
  const temporalValidation = fitTemporalValidation(joinedRows);
  const candidates = fitRollingCandidates(
    joinedRows,
    args.cutoff ?? DEFAULT_CUTOFF,
  );
  const laggedChangeCandidates = fitLaggedChangeCandidates(
    joinedRows,
    args.cutoff ?? DEFAULT_CUTOFF,
  );
  const totalModel = rawLevelCandidates.find(
    (candidate) => candidate.name === "hormuz-total",
  );
  if (args["fit-out"] && totalModel?.coefficients) {
    writeModelFitCsv(
      args["fit-out"],
      joinedRows,
      totalModel.coefficients,
      args.cutoff ?? DEFAULT_CUTOFF,
    );
  }
  console.log(
    JSON.stringify(
      {
        scoreTransform: `score = clamp(round(compositeZ / ${SCORE_SCALE_Z} * 100), 0, 100)`,
        rawLevelCandidates,
        temporalValidation,
        rollingCandidates: candidates.slice(0, 12),
        laggedChangeCandidates: laggedChangeCandidates.slice(0, 12),
      },
      null,
      2,
    ),
  );
}
