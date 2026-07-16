// screens/ComicsScreen.js — the Comics tab. The tab bar resets by screen NAME,
// so this thin wrapper is what lets SearchScreen serve both content types.
import React from "react";
import SearchScreen from "./SearchScreen";

export default function ComicsScreen(props) {
  return <SearchScreen {...props} contentType="comic" />;
}
