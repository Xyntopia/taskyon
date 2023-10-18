class AsyncQueue<T> {
  private queue: T[] = [];
  private resolveWaitingPop?: (value: T) => void;

  push(item: T) {
    this.queue.push(item);
    if (this.resolveWaitingPop) {
      // Since TypeScript now expects queue.shift() to always return a T,
      // we need to assure it's not called on an empty array.
      // The logic ensures it's never empty at this point, but TypeScript doesn't know that.
      this.resolveWaitingPop(this.queue.shift()!);
      this.resolveWaitingPop = undefined;
    }
  }

  async pop(): Promise<T> {
    if (this.queue.length > 0) {
      // Similar to above, we assure TypeScript queue.shift() always returns a T.
      return this.queue.shift()!;
    } else {
      return new Promise<T>((resolve) => {
        this.resolveWaitingPop = resolve;
      });
    }
  }
}

export default AsyncQueue;
