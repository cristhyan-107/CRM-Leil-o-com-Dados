'use client';
/* eslint-disable react-hooks/immutability */

import { useState, useEffect, useCallback } from 'react';
import {
  Smartphone,
  LogOut,
  RefreshCw,
  AlertCircle,
  RotateCcw,
  Loader2,
} from 'lucide-react';
import Image from 'next/image';
import {
  checkWhatsAppStatus,
  connectWhatsApp,
  disconnectWhatsApp,
  syncWhatsAppChats,
  updateWebhookUrl,
} from './actions';
import { ChatInterface } from '@/components/chat/chat-interface';

type PageState =
  | 'LOADING'
  | 'DISCONNECTED'
  | 'QR_READY'
  | 'OPEN'
  | 'SYNCING'
  | 'ERROR'
  | 'UNAUTHORIZED';

export default function WhatsAppSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<PageState>('LOADING');
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [syncStatus, setSyncStatus] = useState('');
  const [syncError, setSyncError] = useState('');
  const [instanceName, setInstanceName] = useState('');
  const [pollingTimeout, setPollingTimeout] = useState<NodeJS.Timeout | null>(null);

  // ============================================================
  // Verificar status ao montar
  // ============================================================

  const loadStatus = useCallback(async () => {
    setLoading(true);
    const res = await checkWhatsAppStatus();
    if (res.success) {
      const s = res.state?.toUpperCase() || 'DISCONNECTED';
      setState(s === 'OPEN' ? 'OPEN' : 'DISCONNECTED');
      setInstanceName(res.instanceName || '');

      // Se conectado, sincronizar chats automaticamente
      if (s === 'OPEN') {
        runSync(res.instanceName);
      }
    } else {
      setState('UNAUTHORIZED');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadStatus();
    return () => stopPolling();
  }, [loadStatus]);

  function stopPolling() {
    if (pollingTimeout) {
      clearTimeout(pollingTimeout);
      setPollingTimeout(null);
    }
  }

  // ============================================================
  // Polling após QR gerado (esperar scan)
  // ============================================================

  function startPolling() {
    const poll = setTimeout(async () => {
      const res = await checkWhatsAppStatus();
      if (res.success && res.state?.toUpperCase() === 'OPEN') {
        setState('OPEN');
        setQrCode(null);
        runSync(res.instanceName);
      } else {
        startPolling();
      }
    }, 3000);
    setPollingTimeout(poll);
  }

  // ============================================================
  // Sincronizar chats + atualizar webhook
  // ============================================================

  async function runSync(_instName?: string) {
    void _instName;
    setState('SYNCING');
    setSyncError('');
    setSyncStatus('Atualizando webhook...');

    // IMPORTANTE: atualizar URL do webhook para Vercel
    await updateWebhookUrl().catch(() => {});

    setSyncStatus('Sincronizando conversas...');
    const syncRes = await syncWhatsAppChats();

    if (syncRes.success) {
      const chats = syncRes.summary?.chatsImported ?? syncRes.count ?? 0;
      const messages = syncRes.summary?.messagesImported ?? 0;
      setSyncStatus(
        chats === 0
          ? 'Sincronização concluída: nenhuma conversa encontrada'
          : `Sincronização concluída: ${chats} conversas, ${messages} mensagens`
      );
    } else {
      setSyncStatus('Erro na sincronização');
    }

    if (!syncRes.success) {
      setSyncError(
        'Não foi possível buscar as conversas da Evolution API. Verifique se a instância está conectada e se o servidor está respondendo.'
      );
    }

    setState('OPEN');
    if (syncRes.success) setTimeout(() => setSyncStatus(''), 5000);
  }

  // ============================================================
  // Gerar QR Code
  // ============================================================

  const handleConnect = async () => {
    setLoading(true);
    setError('');
    setQrCode(null);
    stopPolling();

    const res = await connectWhatsApp();

    if (res.success && res.alreadyConnected) {
      setState('OPEN');
      runSync();
    } else if (res.success && res.qr) {
      setQrCode(res.qr);
      setState('QR_READY');
      startPolling();
    } else {
      setError(
        res.error ||
          'Falha ao gerar QR Code. Verifique se a Evolution API está online.'
      );
      setState('ERROR');
    }

    setLoading(false);
  };

  // ============================================================
  // Desconectar
  // ============================================================

  const handleDisconnect = async () => {
    if (!confirm('Deseja desconectar o WhatsApp desta conta?')) return;
    setLoading(true);
    stopPolling();
    await disconnectWhatsApp();
    setQrCode(null);
    setState('DISCONNECTED');
    setLoading(false);
  };

  // ============================================================
  // Render
  // ============================================================

  const isConnected = state === 'OPEN' || state === 'SYNCING';

  return (
    <div
      className={
        isConnected
          ? 'h-[calc(100vh-4rem)] flex flex-col -m-4 sm:-m-6 bg-[#060a14]'
          : 'max-w-2xl mx-auto space-y-6'
      }
    >
      {/* ---- Header quando desconectado ---- */}
      {!isConnected && (
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight">WhatsApp</h2>
          <p className="text-sm text-gray-400 mt-1">
            Conecte seu WhatsApp para enviar e receber mensagens diretamente no CRM.
          </p>
        </div>
      )}

      {/* ---- Error ---- */}
      {error && !isConnected && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {/* ---- Inbox (conectado) ---- */}
      {isConnected ? (
        <div className="flex-1 flex flex-col h-full overflow-hidden">
          {/* Barra de status */}
          <div className="flex items-center justify-between px-5 py-2.5 bg-[#080d18] border-b border-white/10 shrink-0">
            <div className="flex items-center gap-2">
              {state === 'SYNCING' ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin" />
                  <span className="text-xs font-medium text-blue-400">{syncStatus}</span>
                </>
              ) : (
                <>
                  <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                  <span className="text-xs font-medium text-emerald-400">WhatsApp Conectado</span>
                  {syncStatus && (
                    <span className="text-xs text-gray-500 ml-1">· {syncStatus}</span>
                  )}
                  {syncError && (
                    <span className="text-xs text-red-400 ml-1 cursor-help" title={syncError}>
                      · Ver detalhes
                    </span>
                  )}
                </>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => runSync(instanceName)}
                disabled={state === 'SYNCING'}
                className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-gray-400 hover:text-white bg-white/[0.03] hover:bg-white/[0.07] rounded-lg border border-white/[0.06] transition-colors"
              >
                <RotateCcw className={`w-3 h-3 ${state === 'SYNCING' ? 'animate-spin' : ''}`} />
                Sincronizar
              </button>
              <button
                onClick={handleDisconnect}
                disabled={loading}
                className="flex items-center gap-1.5 px-2.5 py-1 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg text-xs font-medium transition-colors border border-red-500/20"
              >
                <LogOut className="w-3 h-3" />
                Desconectar
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-hidden">
            <ChatInterface instanceName={instanceName} />
          </div>
        </div>
      ) : (
        /* ---- Card de conexão ---- */
        <div className="bg-[#080d18] border border-white/10 rounded-2xl p-6 sm:p-8">
          {loading && state === 'LOADING' ? (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
              <p className="text-sm text-gray-400">Verificando conexão...</p>
            </div>
          ) : (
            <div className="space-y-8">
              {/* Status header */}
              <div className="flex items-center gap-4 border-b border-white/10 pb-6">
                <div className="w-14 h-14 rounded-2xl bg-gray-800/80 flex items-center justify-center shrink-0">
                  <Smartphone className="w-7 h-7 text-gray-500" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-white">Status da Conexão</h3>
                  <div className="flex items-center gap-2 mt-1">
                    <div
                      className={`w-2.5 h-2.5 rounded-full ${
                        state === 'QR_READY' ? 'bg-amber-500 animate-pulse' : 'bg-gray-600'
                      }`}
                    />
                    <p className="text-sm text-gray-400">
                      {state === 'QR_READY'
                        ? 'Aguardando leitura do QR Code...'
                        : state === 'ERROR'
                        ? 'Erro na conexão'
                        : 'Desconectado'}
                    </p>
                  </div>
                </div>
              </div>

              {/* QR Code ou botão */}
              <div className="flex flex-col items-center pt-2">
                {qrCode ? (
                  <div className="space-y-6 flex flex-col items-center">
                    <div className="p-4 bg-white rounded-2xl shadow-2xl border-4 border-[#080d18]">
                      <Image
                        src={
                          qrCode.startsWith('data:')
                            ? qrCode
                            : `data:image/png;base64,${qrCode}`
                        }
                        alt="QR Code WhatsApp"
                        width={256}
                        height={256}
                        className="rounded"
                      />
                    </div>
                    <div className="text-center space-y-2">
                      <p className="text-sm text-gray-400 max-w-xs mx-auto">
                        Abra o WhatsApp → <strong className="text-white">Aparelhos Conectados</strong> → aponte a câmera para o QR acima.
                      </p>
                      <button
                        onClick={loadStatus}
                        className="flex items-center gap-2 text-sm text-blue-400 hover:text-blue-300 mx-auto transition-colors"
                      >
                        <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                        Verificar status manualmente
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4 w-full text-center">
                    <p className="text-sm text-gray-400 max-w-sm mx-auto leading-relaxed">
                      Crie uma sessão e escaneie o QR Code para integrar seu WhatsApp ao CRM.
                    </p>
                    <button
                      onClick={handleConnect}
                      disabled={loading}
                      className="inline-flex items-center justify-center gap-2 px-8 py-3.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-semibold transition-all shadow-[0_0_25px_rgba(5,150,105,0.3)] hover:shadow-[0_0_35px_rgba(5,150,105,0.4)] disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {loading ? (
                        <>
                          <Loader2 className="w-5 h-5 animate-spin" />
                          Aguarde...
                        </>
                      ) : (
                        <>
                          <Smartphone className="w-5 h-5" />
                          Gerar QR Code do WhatsApp
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
