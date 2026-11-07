import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { getPrefix } from './config';
import { closeBook } from './player';
import { getLibrary, applyAccountBook } from './library';
import { createAccountBridge } from './accounts/bridge';

export const accountBridge = createAccountBridge({
  storage: AsyncStorage, secure: SecureStore, getPrefix, getLibrary,
  closePlayback: closeBook, applyRemote: applyAccountBook,
  fetch: (...args) => fetch(...args),
});
