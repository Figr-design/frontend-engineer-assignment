let count = 0;

export function report(error, context) {
  count += 1;
  console.log(`[report #${count}]`, { error, ...context });
}