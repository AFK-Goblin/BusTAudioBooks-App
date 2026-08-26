import { tabBarMetrics } from "../layout";

test("adds the Android navigation inset below tab controls", () => {
  expect(tabBarMetrics(24)).toEqual({ height: 82, paddingBottom: 24 });
  expect(tabBarMetrics(0)).toEqual({ height: 58, paddingBottom: 0 });
});
