export function actionInsertValuesByColumn(call) {
  const match = call.text.match(/INSERT INTO action_records\s*\(([^)]+)\)/s);
  if (!match) throw new Error('expected an action_records INSERT');
  const columns = match[1].split(',').map((column) => column.trim());
  if (columns.length !== call.values.length) throw new Error('action_records INSERT columns and values differ');
  return Object.fromEntries(columns.map((column, index) => [column, call.values[index]]));
}
