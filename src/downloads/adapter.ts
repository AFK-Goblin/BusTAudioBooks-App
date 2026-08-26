type Handlers = {
  begin?: (...args: any[]) => void;
  progress?: (...args: any[]) => void;
  done?: (...args: any[]) => void;
  error?: (...args: any[]) => void;
};

export function createNativeDownload(createTask: (options: any) => any, options: any, handlers: Handlers) {
  const task = createTask(options);
  task
    .begin(handlers.begin ?? (() => {}))
    .progress(handlers.progress ?? (() => {}))
    .done(handlers.done ?? (() => {}))
    .error(handlers.error ?? (() => {}));
  task.start();
  return task;
}
