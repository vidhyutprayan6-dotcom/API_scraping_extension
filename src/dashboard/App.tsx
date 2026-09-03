import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  Badge,
  Button,
  Card,
  Col,
  ConfigProvider,
  Descriptions,
  Drawer,
  Empty,
  Flex,
  Input,
  Layout,
  Row,
  Select,
  Space,
  Statistic,
  Switch,
  Table,
  Tag,
  ThemeConfig,
  Typography,
  message,
  theme,
} from 'antd';
import {
  ClearOutlined,
  DashboardOutlined,
  DownloadOutlined,
  MoonOutlined,
  ReloadOutlined,
  SearchOutlined,
  SunOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import type { CapturedRequest, LoggerSettings, RequestKind } from '../shared/types';
import { DEFAULT_SETTINGS } from '../shared/types';

const { Header, Content } = Layout;
const { Title, Text, Paragraph } = Typography;

const KIND_COLORS: Record<RequestKind, string> = {
  fetch: 'blue',
  xhr: 'cyan',
};

const KIND_LABELS: Record<RequestKind, string> = {
  fetch: 'Fetch',
  xhr: 'XHR',
};

function resolveThemeMode(
  preference: LoggerSettings['theme'],
): 'light' | 'dark' {
  if (preference === 'light' || preference === 'dark') return preference;
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

function statusColor(status?: number | string): string {
  if (status == null) return 'default';
  const code = typeof status === 'number' ? status : Number(status);
  if (Number.isNaN(code)) return 'purple';
  if (code >= 200 && code < 300) return 'success';
  if (code >= 300 && code < 400) return 'processing';
  if (code >= 400 && code < 500) return 'warning';
  if (code >= 500) return 'error';
  return 'default';
}

export default function App() {
  const [logs, setLogs] = useState<CapturedRequest[]>([]);
  const [settings, setSettings] = useState<LoggerSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<CapturedRequest | null>(null);
  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState<RequestKind[]>([]);
  const [methodFilter, setMethodFilter] = useState<string[]>([]);
  const [hostsDraft, setHostsDraft] = useState('');
  const [activeTabId, setActiveTabId] = useState<number | null>(null);
  const [serverOk, setServerOk] = useState(false);
  const [logDir, setLogDir] = useState('log/');
  const [messageApi, contextHolder] = message.useMessage();

  const mode = resolveThemeMode(settings.theme);

  const antdTheme: ThemeConfig = useMemo(
    () => ({
      algorithm: mode === 'dark' ? theme.darkAlgorithm : theme.defaultAlgorithm,
      token: {
        colorPrimary: '#1677ff',
        borderRadius: 8,
        fontFamily:
          '"Segoe UI", "SF Pro Text", -apple-system, BlinkMacSystemFont, sans-serif',
      },
    }),
    [mode],
  );

  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [logsRes, settingsRes] = await Promise.all([
        chrome.runtime.sendMessage({ type: 'GET_LOGS' }),
        chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }),
      ]);
      if (logsRes?.ok === false) {
        setServerOk(false);
        if (!silent) {
          messageApi.error(
            logsRes.error ||
              'Log server unavailable. Run: npm run log-server',
          );
        }
      } else if (logsRes?.logs) {
        setLogs(logsRes.logs);
      }
      if (settingsRes?.settings) {
        setSettings(settingsRes.settings);
        setHostsDraft(settingsRes.settings.targetHosts.join(', '));
      }
      if (settingsRes?.activeTabId != null) {
        setActiveTabId(settingsRes.activeTabId as number);
      }
      if (settingsRes?.server) {
        setServerOk(Boolean(settingsRes.server.ok));
        if (settingsRes.server.logDir) setLogDir(settingsRes.server.logDir);
      }
    } catch (error) {
      setServerOk(false);
      if (!silent) {
        messageApi.error(
          error instanceof Error
            ? error.message
            : 'Failed to load data. Is the log server running?',
        );
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [messageApi]);

  useEffect(() => {
    void loadData();
    const timer = setInterval(() => {
      void loadData(true);
    }, 2000);
    return () => clearInterval(timer);
  }, [loadData]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return logs.filter((log) => {
      if (kindFilter.length && !kindFilter.includes(log.kind)) return false;
      if (methodFilter.length && !methodFilter.includes(String(log.method))) {
        return false;
      }
      if (!q) return true;
      return (
        log.url.toLowerCase().includes(q) ||
        log.origin.toLowerCase().includes(q) ||
        (log.requestBody ?? '').toLowerCase().includes(q) ||
        (log.responseBody ?? '').toLowerCase().includes(q) ||
        (log.error ?? '').toLowerCase().includes(q) ||
        log.kind.includes(q)
      );
    });
  }, [logs, search, kindFilter, methodFilter]);

  const stats = useMemo(() => {
    const byKind = logs.reduce<Record<string, number>>((acc, log) => {
      acc[log.kind] = (acc[log.kind] ?? 0) + 1;
      return acc;
    }, {});
    return {
      total: logs.length,
      byKind,
      fetchCount: byKind.fetch ?? 0,
      xhrCount: byKind.xhr ?? 0,
    };
  }, [logs]);

  const methods = useMemo(
    () =>
      Array.from(new Set(logs.map((l) => String(l.method)))).sort(),
    [logs],
  );

  const updateSettings = async (patch: Partial<LoggerSettings>) => {
    const res = await chrome.runtime.sendMessage({
      type: 'UPDATE_SETTINGS',
      payload: patch,
    });
    if (res?.settings) setSettings(res.settings);
  };

  const clearAll = async () => {
    const res = await chrome.runtime.sendMessage({ type: 'CLEAR_LOGS' });
    if (!res?.ok) {
      messageApi.error(res?.error || 'Clear failed — start npm run log-server');
      return;
    }
    setLogs([]);
    setSelected(null);
    messageApi.success('Logs cleared');
  };

  const exportLogs = async (format: 'txt' | 'json') => {
    const res = await chrome.runtime.sendMessage({
      type: 'EXPORT_LOGS',
      payload: { format },
    });
    if (res?.ok) {
      messageApi.success(`Saved to log/${res.filename}`);
    } else {
      messageApi.error(res?.error || 'Export failed — start npm run log-server');
    }
  };

  const columns: ColumnsType<CapturedRequest> = [
    {
      title: 'Time',
      dataIndex: 'timestamp',
      width: 170,
      render: (value: number) => dayjs(value).format('YYYY-MM-DD HH:mm:ss'),
      sorter: (a, b) => a.timestamp - b.timestamp,
      defaultSortOrder: 'descend',
    },
    {
      title: 'Type',
      dataIndex: 'kind',
      width: 130,
      render: (kind: RequestKind) => (
        <Tag color={KIND_COLORS[kind]}>{KIND_LABELS[kind]}</Tag>
      ),
    },
    {
      title: 'Method',
      dataIndex: 'method',
      width: 90,
      render: (method: string) => <Tag>{method}</Tag>,
    },
    {
      title: 'Status',
      dataIndex: 'status',
      width: 100,
      render: (status: number | string | undefined, row) =>
        row.error ? (
          <Tag color="error">ERR</Tag>
        ) : (
          <Tag color={statusColor(status)}>{status ?? '—'}</Tag>
        ),
    },
    {
      title: 'URL',
      dataIndex: 'url',
      ellipsis: true,
      render: (url: string) => (
        <Text style={{ maxWidth: 420 }} ellipsis={{ tooltip: url }}>
          {url}
        </Text>
      ),
    },
    {
      title: 'Duration',
      dataIndex: 'durationMs',
      width: 100,
      render: (ms?: number) => (ms != null ? `${ms} ms` : '—'),
    },
    {
      title: 'Direction',
      dataIndex: 'direction',
      width: 120,
      render: (d: string) => <Tag>{d}</Tag>,
    },
  ];

  return (
    <ConfigProvider theme={antdTheme}>
      {contextHolder}
      <Layout style={{ minHeight: '100vh' }}>
        <Header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingInline: 24,
            borderBottom: `1px solid ${
              mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'
            }`,
            background: mode === 'dark' ? '#141414' : '#fff',
          }}
        >
          <Space size="middle">
            <DashboardOutlined style={{ fontSize: 20, color: '#1677ff' }} />
            <Title level={4} style={{ margin: 0 }}>
              API Request Logger
            </Title>
            <Badge
              status={settings.enabled && serverOk ? 'processing' : 'default'}
              text={
                !serverOk
                  ? 'Log server offline'
                  : settings.enabled
                    ? `Capturing active tab${activeTabId != null ? ` #${activeTabId}` : ''}`
                    : 'Paused'
              }
            />
          </Space>
          <Space>
            <Text type="secondary">Capture</Text>
            <Switch
              checked={settings.enabled}
              onChange={(checked) => void updateSettings({ enabled: checked })}
            />
            <Button
              icon={mode === 'dark' ? <SunOutlined /> : <MoonOutlined />}
              onClick={() =>
                void updateSettings({
                  theme: mode === 'dark' ? 'light' : 'dark',
                })
              }
            >
              {mode === 'dark' ? 'Light' : 'Dark'}
            </Button>
            <Button icon={<ReloadOutlined />} onClick={() => void loadData()}>
              Refresh
            </Button>
            <Button
              icon={<DownloadOutlined />}
              onClick={() => void exportLogs('txt')}
            >
              Export TXT
            </Button>
            <Button onClick={() => void exportLogs('json')}>Export JSON</Button>
            <Button
              danger
              icon={<ClearOutlined />}
              onClick={() => void clearAll()}
            >
              Clear
            </Button>
          </Space>
        </Header>

        <Content style={{ padding: 24 }}>
          <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
            <Col xs={24} sm={12} md={6}>
              <Card>
                <Statistic title="Total captured" value={stats.total} />
              </Card>
            </Col>
            <Col xs={24} sm={12} md={6}>
              <Card>
                <Statistic
                  title="Filtered view"
                  value={filtered.length}
                  valueStyle={{ color: '#1677ff' }}
                />
              </Card>
            </Col>
            <Col xs={24} sm={12} md={6}>
              <Card>
                <Statistic title="Fetch APIs" value={stats.fetchCount} />
              </Card>
            </Col>
            <Col xs={24} sm={12} md={6}>
              <Card>
                <Statistic title="XHR APIs" value={stats.xhrCount} />
              </Card>
            </Col>
          </Row>

          <Card
            title="Captured requests"
            extra={
              <Space wrap>
                <Input
                  allowClear
                  prefix={<SearchOutlined />}
                  placeholder="Search URL, body, error…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  style={{ width: 260 }}
                />
                <Select
                  mode="multiple"
                  allowClear
                  placeholder="Request type"
                  style={{ minWidth: 200 }}
                  value={kindFilter}
                  onChange={setKindFilter}
                  options={(Object.keys(KIND_LABELS) as RequestKind[]).map(
                    (k) => ({
                      value: k,
                      label: KIND_LABELS[k],
                    }),
                  )}
                />
                <Select
                  mode="multiple"
                  allowClear
                  placeholder="Method"
                  style={{ minWidth: 140 }}
                  value={methodFilter}
                  onChange={setMethodFilter}
                  options={methods.map((m) => ({ value: m, label: m }))}
                />
                <Flex align="center" gap={8}>
                  <Text type="secondary">Bodies</Text>
                  <Switch
                    size="small"
                    checked={settings.captureBodies}
                    onChange={(checked) =>
                      void updateSettings({ captureBodies: checked })
                    }
                  />
                </Flex>
              </Space>
            }
          >
            <Space wrap style={{ marginBottom: 12 }}>
              {(Object.keys(KIND_LABELS) as RequestKind[]).map((kind) => (
                <Tag key={kind} color={KIND_COLORS[kind]}>
                  {KIND_LABELS[kind]}: {stats.byKind[kind] ?? 0}
                </Tag>
              ))}
            </Space>

            <Table
              rowKey="id"
              loading={loading}
              columns={columns}
              dataSource={filtered}
              size="middle"
              pagination={{ pageSize: 50, showSizeChanger: true }}
              scroll={{ x: 1100 }}
              locale={{
                emptyText: (
                  <Empty description="No API requests captured yet. Keep this site’s tab focused while capture is enabled." />
                ),
              }}
              onRow={(record) => ({
                onClick: () => setSelected(record),
                style: { cursor: 'pointer' },
              })}
            />
          </Card>

          <Card title="Persistence" style={{ marginTop: 16 }}>
            <Paragraph type="secondary" style={{ marginTop: 0 }}>
              Data is written to the extension project <Text code>log/</Text>{' '}
              folder (not Chrome storage). Start the local writer with{' '}
              <Text code>npm run log-server</Text>.
            </Paragraph>
            <Paragraph style={{ marginBottom: 0 }}>
              Status:{' '}
              <Badge
                status={serverOk ? 'success' : 'error'}
                text={serverOk ? 'Connected' : 'Offline'}
              />
            </Paragraph>
            <Paragraph style={{ marginBottom: 0 }}>
              Folder: <Text code>{logDir}</Text>
            </Paragraph>
            <Paragraph style={{ marginBottom: 0 }}>
              Main file: <Text code>log/captured-requests.json</Text>
            </Paragraph>
          </Card>

          <Card title="Target hosts (optional)" style={{ marginTop: 16 }}>
            <Paragraph type="secondary" style={{ marginTop: 0 }}>
              Leave empty to capture all sites. Use comma-separated hosts, e.g.
              <Text code>example.com, *.api.example.com</Text>
            </Paragraph>
            <Input.TextArea
              rows={2}
              value={hostsDraft}
              onChange={(e) => setHostsDraft(e.target.value)}
              placeholder="example.com, api.example.com"
            />
            <Button
              style={{ marginTop: 8 }}
              type="primary"
              onClick={() =>
                void updateSettings({
                  targetHosts: hostsDraft
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean),
                }).then(() => messageApi.success('Target hosts saved'))
              }
            >
              Save hosts
            </Button>
          </Card>
        </Content>
      </Layout>

      <Drawer
        title="Request details"
        width={720}
        open={!!selected}
        onClose={() => setSelected(null)}
        destroyOnClose
      >
        {selected && (
          <Space direction="vertical" size="large" style={{ width: '100%' }}>
            <Space wrap>
              <Tag color={KIND_COLORS[selected.kind]}>
                {KIND_LABELS[selected.kind]}
              </Tag>
              <Tag>{selected.method}</Tag>
              {selected.status != null && (
                <Tag color={statusColor(selected.status)}>{selected.status}</Tag>
              )}
            </Space>

            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="Time">
                {dayjs(selected.timestamp).format('YYYY-MM-DD HH:mm:ss.SSS')}
              </Descriptions.Item>
              <Descriptions.Item label="URL">{selected.url}</Descriptions.Item>
              <Descriptions.Item label="Origin">
                {selected.origin}
              </Descriptions.Item>
              <Descriptions.Item label="Direction">
                {selected.direction}
              </Descriptions.Item>
              <Descriptions.Item label="Duration">
                {selected.durationMs != null
                  ? `${selected.durationMs} ms`
                  : '—'}
              </Descriptions.Item>
              <Descriptions.Item label="Tab">
                {selected.tabTitle ?? '—'}
              </Descriptions.Item>
              {selected.error && (
                <Descriptions.Item label="Error">
                  <Text type="danger">{selected.error}</Text>
                </Descriptions.Item>
              )}
            </Descriptions>

            {selected.requestHeaders && (
              <Card size="small" title="Request headers" type="inner">
                <pre style={preStyle}>{JSON.stringify(selected.requestHeaders, null, 2)}</pre>
              </Card>
            )}
            {selected.requestBody && (
              <Card size="small" title="Request body" type="inner">
                <pre style={preStyle}>{selected.requestBody}</pre>
              </Card>
            )}
            {selected.responseHeaders && (
              <Card size="small" title="Response headers" type="inner">
                <pre style={preStyle}>{JSON.stringify(selected.responseHeaders, null, 2)}</pre>
              </Card>
            )}
            {selected.responseBody && (
              <Card size="small" title="Response body" type="inner">
                <pre style={preStyle}>{selected.responseBody}</pre>
              </Card>
            )}
            {selected.meta && (
              <Card size="small" title="Meta" type="inner">
                <pre style={preStyle}>{JSON.stringify(selected.meta, null, 2)}</pre>
              </Card>
            )}
          </Space>
        )}
      </Drawer>
    </ConfigProvider>
  );
}

const preStyle: CSSProperties = {
  margin: 0,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  fontSize: 12,
  maxHeight: 320,
  overflow: 'auto',
};
