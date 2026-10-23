import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { theme } from "../theme";
import { Sheet, GradientButton } from "../ui";
import { WHATS_NEW } from "../whatsNew";

export function WhatsNewSheet({ visible, onClose }) {
  return (
    <Sheet visible={visible} onClose={onClose} title="What's new" maxHeight={520}>
      {WHATS_NEW.items.map((item) => (
        <View key={item.title} style={styles.item}>
          <View style={styles.icon}><Text style={styles.iconTxt}>{item.icon}</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{item.title}</Text>
            <Text style={styles.body}>{item.body}</Text>
          </View>
        </View>
      ))}
      <GradientButton title="Got it" onPress={onClose} style={styles.done} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  item: { flexDirection: "row", gap: 14, paddingHorizontal: 8, paddingVertical: 10, alignItems: "flex-start" },
  icon: { width: 40, height: 40, borderRadius: 12, backgroundColor: theme.accent + "29", alignItems: "center", justifyContent: "center" },
  iconTxt: { fontSize: 19, color: theme.accent, fontWeight: "800" },
  title: { color: theme.text, fontWeight: "700", fontSize: 15 },
  body: { color: theme.sub, fontSize: 13, lineHeight: 18, marginTop: 2 },
  done: { marginTop: 10, marginHorizontal: 8 },
});
