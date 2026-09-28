// Error reporter stub. Call it for every failure, as described in R6.4.
// Replace the import style to suit your stack; keep the signature.
//
//   report(error, { region, screenId, elementKey })
//
//   region     "board" | "preview" | "layers" | "layers-row" | "details" | "inspector"
//   screenId   the screen the failure belongs to, or null for the board
//   elementKey optional, the element's data-key when relevant

let count = 0;

export function report(error, context) {
  count += 1;
  console.log(`[report #${count}]`, { error, ...context });
}
