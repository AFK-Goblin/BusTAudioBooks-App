import { createNativeDownload } from "../adapter";

test("attaches callbacks before explicitly starting a new native download", () => {
  const start = jest.fn();
  const task: any = {
    begin: jest.fn().mockReturnThis(),
    progress: jest.fn().mockReturnThis(),
    done: jest.fn().mockReturnThis(),
    error: jest.fn().mockReturnThis(),
    start,
  };
  const createTask = jest.fn(() => task);
  createNativeDownload(createTask, { id: "x", url: "https://x", destination: "/x" }, {});
  expect(createTask).toHaveBeenCalled();
  expect(task.progress).toHaveBeenCalled();
  expect(start).toHaveBeenCalledTimes(1);
});
