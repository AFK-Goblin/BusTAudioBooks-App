/* global test, beforeEach */
import React from 'react';
import { Alert } from 'react-native';
import { render, screen, fireEvent, act } from '@testing-library/react-native';
import AccountScreen from '../../../screens/AccountScreen';
import { accountBridge } from '../../account';
jest.mock('../../account', () => ({ accountBridge: {
  status: jest.fn(), authenticate: jest.fn(), linkPhone: jest.fn(), sync: jest.fn(), signOut: jest.fn(), resolveConflict: jest.fn(),
} }));
beforeEach(() => {
  jest.clearAllMocks();
  accountBridge.status.mockResolvedValue({ user: { id: 'alice', username: 'Alice' }, linked: false, owner: null });
  accountBridge.linkPhone.mockResolvedValue({ user: { id: 'alice', username: 'Alice' }, linked: true });
  accountBridge.sync.mockResolvedValue({ conflicts: [], notices: [] });
});
test('phone library is linked only after the explicit confirmation', async () => {
  const alert = jest.spyOn(Alert, 'alert');
  await render(<AccountScreen nav={{ goBack() {} }} />);
  await fireEvent.press(await screen.findByText('Link and sync this phone'));
  expect(accountBridge.linkPhone).not.toHaveBeenCalled();
  expect(accountBridge.sync).not.toHaveBeenCalled();
  const buttons = alert.mock.calls.at(-1)[2];
  await act(async () => { await buttons.find(b => b.text === 'Link and sync').onPress(); });
  expect(accountBridge.linkPhone).toHaveBeenCalledTimes(1);
  expect(await screen.findByText(/Sync complete/)).toBeTruthy();
  alert.mockRestore();
});
test('sync exposes both conflict choices and cloud deletion information', async () => {
  accountBridge.status.mockResolvedValue({ user: { id: 'alice', username: 'Alice' }, linked: true });
  accountBridge.sync.mockResolvedValue({ conflicts: [{ id: 'b', title: 'Book', local: { progress: { position: 20 } }, remote: { deleted: true } }], notices: [] });
  await render(<AccountScreen nav={{ goBack() {} }} />);
  await fireEvent.press(await screen.findByText('Sync now'));
  expect(await screen.findByText('Keep phone')).toBeTruthy();
  expect(screen.getByText('Use cloud')).toBeTruthy();
  expect(screen.getByText(/Cloud: removed/)).toBeTruthy();
});

test('sync screen shows phone counts and server-confirmed counts instead of an unqualified success', async () => {
  accountBridge.status.mockResolvedValue({ user: { id: 'baz', username: 'baz' }, linked: true, phoneLibrary: { total: 8, inProgress: 5, finished: 3 } });
  accountBridge.sync.mockResolvedValue({ conflicts: [], notices: [], summary: { phone: { total: 8, inProgress: 5, finished: 3 }, cloud: { total: 8, inProgress: 5, finished: 3 } } });
  await render(<AccountScreen nav={{ goBack() {} }} />);
  expect(await screen.findByText('On this phone: 8 books · 5 in progress · 3 finished')).toBeTruthy();
  await fireEvent.press(await screen.findByText('Sync now'));
  expect(await screen.findByText('Confirmed in your account: 8 books · 5 in progress · 3 finished')).toBeTruthy();
  expect(screen.queryByText('Sync complete. Your personal library is up to date.')).toBeNull();
});
