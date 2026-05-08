function escapeCsvCell(value) {
  if (value === null || value === undefined) {
    return "";
  }

  const text =
    typeof value === "string"
      ? value
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);

  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

function toCsv(columns, rows) {
  const header = columns.map((column) => escapeCsvCell(column.label)).join(",");
  const body = rows.map((row) =>
    columns.map((column) => escapeCsvCell(row[column.key])).join(",")
  );
  return [header, ...body].join("\n");
}

module.exports = {
  toCsv,
};
