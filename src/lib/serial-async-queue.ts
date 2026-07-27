export function createSerialAsyncQueue<T>(worker: (value: T) => Promise<unknown>) {
  let tail: Promise<void> = Promise.resolve();

  return (value: T) => {
    const run = tail.then(() => worker(value)).then(() => undefined);
    tail = run.catch(() => undefined);
    return run;
  };
}
