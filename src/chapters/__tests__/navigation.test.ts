import { nextStep, previousStep } from "../navigation";

const chapters = [{ start: 0, title: "One" }, { start: 600, title: "Two" }, { start: 1200, title: "Three" }];

test("previous restarts the chapter, or goes to the one before within its first seconds", () => {
  expect(previousStep(chapters, 700, 0)).toEqual({ trackIndex: 0, position: 600 });
  expect(previousStep(chapters, 601, 0)).toEqual({ trackIndex: 0, position: 0 });
  // First chapter of a later part: back to the previous part.
  expect(previousStep(chapters, 1, 2)).toEqual({ trackIndex: 1, position: 0 });
});

test("without chapters, previous restarts the part, then steps back a part", () => {
  expect(previousStep(null, 90, 3)).toEqual({ trackIndex: 3, position: 0 });
  expect(previousStep(null, 2, 3)).toEqual({ trackIndex: 2, position: 0 });
  expect(previousStep(null, 2, 0)).toEqual({ trackIndex: 0, position: 0 });
});

test("next goes to the next chapter, then the next part, then nowhere", () => {
  expect(nextStep(chapters, 700, 0, 2)).toEqual({ trackIndex: 0, position: 1200 });
  expect(nextStep(chapters, 1300, 0, 2)).toEqual({ trackIndex: 1, position: 0 });
  expect(nextStep(chapters, 1300, 1, 2)).toBeNull();
  expect(nextStep(null, 10, 0, 1)).toBeNull();
});
