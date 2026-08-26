import React, { Component, type ErrorInfo, type ReactNode } from "react";
import { Share, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { redactDiagnosticValue } from "../diagnostics/redact";

type Props = { children: ReactNode };
type State = { error: Error | null; report: string | null; resetKey: number };

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null, report: null, resetKey: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> { return { error }; }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const safe = redactDiagnosticValue({ message: error.message, stack: error.stack, componentStack: info.componentStack });
    this.setState({ report: JSON.stringify(safe, null, 2) });
  }

  restart = () => this.setState((state) => ({ error: null, report: null, resetKey: state.resetKey + 1 }));
  share = () => this.state.report ? Share.share({ title: "BusTAudio diagnostics", message: this.state.report }) : undefined;

  render() {
    if (!this.state.error) return <React.Fragment key={this.state.resetKey}>{this.props.children}</React.Fragment>;
    return (
      <View style={styles.root} accessibilityRole="alert">
        <Text style={styles.title}>BusTAudio hit a problem</Text>
        <Text style={styles.body}>Your library and listening progress are safe. Restart this screen, or share a privacy-filtered report if it keeps happening.</Text>
        <TouchableOpacity accessibilityRole="button" style={styles.primary} onPress={this.restart}>
          <Text style={styles.primaryText}>Restart app view</Text>
        </TouchableOpacity>
        {this.state.report && <TouchableOpacity accessibilityRole="button" style={styles.secondary} onPress={this.share}>
          <Text style={styles.secondaryText}>Share diagnostics</Text>
        </TouchableOpacity>}
      </View>
    );
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "center", padding: 28, backgroundColor: "#0b0d12" },
  title: { color: "#fff", fontSize: 24, fontWeight: "700", marginBottom: 12 },
  body: { color: "#b9bec9", fontSize: 16, lineHeight: 23, marginBottom: 24 },
  primary: { backgroundColor: "#7357ff", borderRadius: 12, padding: 15, alignItems: "center" },
  primaryText: { color: "#fff", fontWeight: "700" },
  secondary: { marginTop: 12, borderColor: "#343844", borderWidth: 1, borderRadius: 12, padding: 15, alignItems: "center" },
  secondaryText: { color: "#e8e9ee", fontWeight: "600" },
});
