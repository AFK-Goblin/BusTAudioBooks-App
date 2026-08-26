module.exports = {
  preset: "jest-expo",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.js"],
  testPathIgnorePatterns: ["<rootDir>/dist/", "<rootDir>/dist-check/", "<rootDir>/.worktrees/"],
  modulePathIgnorePatterns: ["<rootDir>/.worktrees/"],
};
