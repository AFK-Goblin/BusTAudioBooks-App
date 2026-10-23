/* global test, beforeEach */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { whatsNewPending, markWhatsNewSeen } from "../whatsNew";

beforeEach(() => AsyncStorage.clear());

test("what's new shows until it's been seen", async () => {
  expect(await whatsNewPending()).toBe(true);
  await markWhatsNewSeen();
  expect(await whatsNewPending()).toBe(false);
});
