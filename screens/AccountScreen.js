import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Alert, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { accountBridge } from '../src/account';
import { theme } from '../src/theme';
import { useScreenPad } from '../src/layout';
import { formatTime } from '../src/format';

export default function AccountScreen({ nav }) {
  const pad = useScreenPad();
  const [account, setAccount] = useState(null);
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [invite, setInvite] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [conflicts, setConflicts] = useState([]);
  const [notices, setNotices] = useState([]);
  useEffect(() => {
    let alive = true;
    accountBridge.status().then(value => { if (alive) setAccount(value); }).catch(() => { if (alive) setMessage('Could not read your account. Try reopening this screen.'); });
    return () => { alive = false; };
  }, []);
  async function run(fn) {
    if (busy) return;
    setBusy(true); setMessage('');
    try { await fn(); } catch (error) { setMessage(error.message || 'Could not complete this action. Try again.'); }
    finally { setBusy(false); }
  }
  async function sync() {
    const result = await accountBridge.sync();
    setConflicts(result.conflicts); setNotices(result.notices);
    setMessage(result.conflicts.length ? 'Choose which version to keep for the books below.' : 'Sync complete. Your personal library is up to date.');
  }
  function link() {
    Alert.alert('Link this phone library?', `Add this phone’s books and listening history to ${account.user.username}’s private library? This phone stays linked to that account. Playback will close so your place can sync safely.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Link and sync', onPress: () => run(async () => { setAccount(await accountBridge.linkPhone()); await sync(); }) },
    ]);
  }
  const button = (label, action, primary = false) => <TouchableOpacity style={[styles.button, primary && styles.primary, busy && { opacity: 0.5 }]} disabled={busy} accessibilityRole="button" onPress={action}><Text style={[styles.buttonText, primary && { color: '#fff' }]}>{label}</Text></TouchableOpacity>;
  return <KeyboardAvoidingView style={[styles.wrap, { paddingTop: pad }]} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 100 }}>
      {button('Back to settings', nav.goBack)}
      <Text style={styles.title}>Personal library</Text>
      <Text style={styles.help}>Your saved books, bookmarks and listening progress belong to your account. The audiobook catalogue is shared.</Text>
      {account?.user ? <View style={styles.card}>
        <Text style={styles.heading}>Signed in as {account.user.username}</Text>
        <Text style={styles.help}>{account.linked ? 'Sync is manual. Sync before switching between your phone and computer. Sync closes playback and saves your current place. Audio downloads stay on this device.' : 'Signing in does not upload this phone’s library. Link it only if these books and listening history belong to you.'}</Text>
        {button(account.linked ? 'Sync now' : 'Link and sync this phone', account.linked ? () => run(sync) : link, true)}
        <Text style={styles.help}>Signing out keeps your local books on this phone. Only the linked account can sync them again. Switching this phone library to another owner is not supported.</Text>
        {button('Sign out', () => run(async () => { await accountBridge.signOut(); setAccount(await accountBridge.status()); setConflicts([]); setNotices([]); setMessage('Signed out. Your local books remain on this phone.'); }))}
      </View> : <View style={styles.card}>
        <Text style={styles.heading}>{mode === 'login' ? 'Sign in' : 'Create your private account'}</Text>
        <Text style={styles.help}>{mode === 'register' ? 'Ask the server owner for an invitation made for your username. Choose a password of at least 12 characters.' : 'Use the same account on Windows and your phone. New users need a personal invitation from the server owner.'}</Text>
        <TextInput style={styles.input} accessibilityLabel="Username" placeholder="Username" placeholderTextColor={theme.dim} value={username} onChangeText={setUsername} autoCapitalize="none" autoCorrect={false} editable={!busy} />
        <TextInput style={styles.input} accessibilityLabel="Password" placeholder="Password" placeholderTextColor={theme.dim} value={password} onChangeText={setPassword} secureTextEntry editable={!busy} autoCapitalize="none" autoCorrect={false} />
        {mode === 'register' && <TextInput style={styles.input} accessibilityLabel="Invitation code" placeholder="Invitation code" placeholderTextColor={theme.dim} value={invite} onChangeText={setInvite} autoCapitalize="none" autoCorrect={false} editable={!busy} />}
        {button(mode === 'login' ? 'Sign in' : 'Create account', () => run(async () => { setAccount(await accountBridge.authenticate(mode, { username: username.trim().toLowerCase(), password, invite: invite.trim() })); setPassword(''); setInvite(''); }), true)}
        {button(mode === 'login' ? 'I have an invitation' : 'I already have an account', () => { setMode(mode === 'login' ? 'register' : 'login'); setMessage(''); })}
        <Text style={styles.help}>Personal libraries need the account update installed on your server. You can keep using your local library while it is being set up.</Text>
      </View>}
      {busy && <ActivityIndicator color={theme.accent} accessibilityLabel="Working" />}
      {message ? <Text style={styles.message} accessibilityLiveRegion="polite">{message}</Text> : null}
      {notices.map((notice, i) => <Text key={i} style={styles.help}>{notice}</Text>)}
      {conflicts.map(item => <View key={item.id} style={styles.card}>
        <Text style={styles.heading}>{item.title}</Text>
        <Text style={styles.help}>Phone: {item.local ? `part ${(item.local.progress?.trackIndex || 0) + 1}, ${formatTime(item.local.progress?.position || 0)}` : 'removed'}</Text>
        <Text style={styles.help}>Cloud: {item.remote.deleted ? 'removed' : `part ${(item.remote.book?.progress?.trackIndex || 0) + 1}, ${formatTime(item.remote.book?.progress?.position || 0)}`}</Text>
        <Text style={styles.help}>This choice includes saved status, ratings and bookmarks. An offline copy stays on the phone if the cloud version was removed.</Text>
        {['phone', 'cloud'].map(choice => <View key={choice}>{button(choice === 'phone' ? 'Keep phone' : 'Use cloud', () => run(async () => { const result = await accountBridge.resolveConflict(item.id, choice); setConflicts(result.conflicts); setNotices(result.notices); setMessage(result.conflicts.length ? 'Review the remaining changes below.' : 'Sync complete.'); }))}</View>)}
      </View>)}
    </ScrollView>
  </KeyboardAvoidingView>;
}
const styles = StyleSheet.create({
  wrap: { flex: 1, paddingHorizontal: 20, backgroundColor: theme.bg },
  title: { color: theme.text, fontWeight: '800', fontSize: 28, marginVertical: 18 },
  heading: { color: theme.text, fontWeight: '700', fontSize: 17, marginBottom: 10 },
  help: { color: theme.sub, fontSize: 14, lineHeight: 22, marginVertical: 8 },
  card: { backgroundColor: theme.card, borderRadius: 16, padding: 18, marginVertical: 12 },
  input: { color: theme.text, backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.border, borderRadius: 10, minHeight: 48, padding: 12, marginVertical: 7 },
  button: { minHeight: 48, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: theme.border, borderRadius: 12, padding: 12, marginVertical: 6 },
  primary: { backgroundColor: theme.button }, buttonText: { color: theme.text, fontWeight: '700' },
  message: { color: theme.text, lineHeight: 22, marginVertical: 12 },
});
