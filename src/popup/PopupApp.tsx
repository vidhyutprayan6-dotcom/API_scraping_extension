import { useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  ConfigProvider,
  Divider,
  Flex,
  Space,
  Switch,
  Typography,
  theme,
  message,
} from 'antd';
import {
  ClearOutlined,
  DashboardOutlined,
  DownloadOutlined,
  MoonOutlined,
  SunOutlined,
} from '@ant-design/icons';
import type { CapturedRequest, LoggerSettings } from '../shared/types';
import { DEFAULT_SETTINGS } from '../shared/types';

const { Text, Title } = Typography;

export default function PopupApp() {
  const [settings, setSettings] = useState<LoggerSettings>(DEFAULT_SETTINGS);
  const [count, setCount] = useState(0);
  const [activeTabId, setActiveTabId] = useState<number | null>(null);
  const [serverOk, setServerOk] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();

  const mode =
    settings.theme === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : settings.theme;

  const antdTheme = useMemo(
    () => ({
      algorithm: mode === 'dark' ? theme.darkAlgorithm : theme.defaultAlgorithm,
      token: { colorPrimary: '#1677ff', borderRadius: 8 },
    }),
    [mode],
  );

  useEffect(() => {
    void (async () => {
      const [logsRes, settingsRes] = await Promise.all([
        chrome.runtime.sendMessage({ type: 'GET_LOGS' }),
        chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }),
      ]);
      setCount((logsRes?.logs as CapturedRequest[] | undefined)?.length ?? 0);
      if (settingsRes?.settings) setSettings(settingsRes.settings);
      if (settingsRes?.activeTabId != null) {
        setActiveTabId(settingsRes.activeTabId as number);
      }
      setServerOk(Boolean(settingsRes?.server?.ok));
    })();
  }, []);

  const updateSettings = async (patch: Partial<LoggerSettings>) => {
    const res = await chrome.runtime.sendMessage({
      type: 'UPDATE_SETTINGS',
      payload: patch,
    });
    if (res?.settings) setSettings(res.settings);
    if (res?.server) setServerOk(Boolean(res.server.ok));
  };

  const openDashboard = () => {
    chrome.runtime.openOptionsPage();
  };

  return (
    <ConfigProvider theme={antdTheme}>
      {contextHolder}
      <div
        style={{
          width: 320,
          padding: 16,
          background: mode === 'dark' ? '#141414' : '#fff',
        }}
      >
        <Flex justify="space-between" align="center">
          <Space>
            <DashboardOutlined style={{ color: '#1677ff' }} />
            <Title level={5} style={{ margin: 0 }}>
              API Logger
            </Title>
          </Space>
          <Button
            size="small"
            icon={mode === 'dark' ? <SunOutlined /> : <MoonOutlined />}
            onClick={() =>
              void updateSettings({ theme: mode === 'dark' ? 'light' : 'dark' })
            }
          />
        </Flex>

        <Divider style={{ margin: '12px 0' }} />

        <Flex justify="space-between" align="center" style={{ marginBottom: 8 }}>
          <Text>Log server</Text>
          <Badge
            status={serverOk ? 'success' : 'error'}
            text={serverOk ? 'Online' : 'Offline'}
          />
        </Flex>

        <Flex justify="space-between" align="center" style={{ marginBottom: 8 }}>
          <Text>Capture APIs (active tab)</Text>
          <Switch
            checked={settings.enabled}
            onChange={(checked) => void updateSettings({ enabled: checked })}
          />
        </Flex>

        <Flex justify="space-between" align="center" style={{ marginBottom: 8 }}>
          <Text type="secondary">Active tab</Text>
          <Text>{activeTabId != null ? `#${activeTabId}` : '—'}</Text>
        </Flex>

        <Flex justify="space-between" align="center" style={{ marginBottom: 12 }}>
          <Text type="secondary">Logged APIs</Text>
          <Badge
            count={count}
            overflowCount={9999}
            style={{ backgroundColor: '#1677ff' }}
            showZero
          />
        </Flex>

        <Text type="secondary" style={{ display: 'block', marginBottom: 12, fontSize: 12 }}>
          Saves to project folder: log/captured-requests.json
        </Text>

        <Space direction="vertical" style={{ width: '100%' }}>
          <Button type="primary" block icon={<DashboardOutlined />} onClick={openDashboard}>
            Open dashboard
          </Button>
          <Button
            block
            icon={<DownloadOutlined />}
            onClick={async () => {
              const res = await chrome.runtime.sendMessage({
                type: 'EXPORT_LOGS',
                payload: { format: 'json' },
              });
              if (res?.ok) messageApi.success(`Saved log/${res.filename}`);
              else messageApi.error(res?.error || 'Start npm run log-server');
            }}
          >
            Export JSON to log/
          </Button>
          <Button
            block
            danger
            icon={<ClearOutlined />}
            onClick={async () => {
              const res = await chrome.runtime.sendMessage({ type: 'CLEAR_LOGS' });
              if (res?.ok) {
                setCount(0);
                messageApi.success('Cleared');
              } else {
                messageApi.error(res?.error || 'Clear failed');
              }
            }}
          >
            Clear logs
          </Button>
        </Space>
      </div>
    </ConfigProvider>
  );
}
