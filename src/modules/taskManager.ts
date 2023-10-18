class AsyncQueue {
  private queue: (() => Promise<void>)[] = [];
  private processing = false;

  async enqueue(task: () => Promise<void>): Promise<void> {
    this.queue.push(task);
    if (!this.processing) {
      this.processing = true;
      await this.processNext();
    }
  }

  private async processNext(): Promise<void> {
    if (this.queue.length === 0) {
      this.processing = false;
      return;
    }

    const task = this.queue.shift();
    if (task) {
      try {
        await task();
      } catch (error) {
        console.error('Error processing task:', error);
      }

      // Process the next task in the queue
      await this.processNext();
    }
  }
}
