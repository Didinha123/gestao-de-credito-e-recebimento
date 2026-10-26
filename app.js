/*
 * app.js — CrediGestor: todo o JavaScript da aplicação em um único arquivo.
 *
 * Seções (na ordem):
 *   1. CONFIGURAÇÃO DO SUPABASE  ← edite apenas esta seção antes de publicar
 *   2. Autenticação e sessão
 *   3. Utilitários, layout, modais e tabelas
 *   4. Motor financeiro (precisão decimal)
 *   5. Pagamentos · Painel · Clientes · Contratos · Parcelas · Fluxo de caixa
 *      · Relatórios · Configurações · Testes
 *
 * Tudo roda no index.html: cada tela é um <template id="tpl-..."> e a navegação usa #tela
 * (ex.: index.html#clientes). App.boot() inicia a aplicação.
 */

/* ==========================================================================
 * config.js
 * ========================================================================== */
/*
 * config.js — Configuração PÚBLICA do Supabase.
 *
 * Preencha com os dados de Project Settings → API do seu projeto Supabase:
 *   - SUPABASE_URL: URL do projeto (https://xxxx.supabase.co)
 *   - SUPABASE_PUBLISHABLE_KEY: chave publicável (sb_publishable_...) ou a
 *     chave "anon" legada. Ela é pública por design; a segurança vem do RLS.
 *
 * NUNCA coloque aqui a chave service_role / secret (sb_secret_...).
 * O sistema se recusa a iniciar se detectar uma chave secreta.
 */
window.APP_CONFIG = Object.freeze({
  SUPABASE_URL: 'https://qxwpdbhciukwspscziik.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_-W_AsuDH-dyEVrijJkrktA_S3nAbUEY',
  APP_NAME: 'CrediGestor',
  TIMEZONE: 'America/Sao_Paulo',
  PAGE_SIZE: 15,
});

/* ==========================================================================
 * auth.js
 * ========================================================================== */
/*
 * auth.js — Cliente Supabase, sessão, perfil, permissões e tela de login.
 */
(function () {
  'use strict';

  const cfg = window.APP_CONFIG || {};

  /** Verifica a configuração e bloqueia chaves secretas no navegador. */
  function configProblem() {
    const url = String(cfg.SUPABASE_URL || '');
    const key = String(cfg.SUPABASE_PUBLISHABLE_KEY || '');
    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
      return 'A biblioteca do Supabase não carregou. Verifique sua conexão com a internet.';
    }
    if (!url || url.includes('SEU-PROJETO') || !/^https:\/\/[^\s/]+$/i.test(url)) {
      return 'Configure SUPABASE_URL no início do app.js (ex.: https://xxxx.supabase.co).';
    }
    if (!key || key.startsWith('COLE_')) {
      return 'Configure SUPABASE_PUBLISHABLE_KEY no início do app.js com a chave publicável do projeto.';
    }
    if (key.startsWith('sb_secret_')) {
      return 'BLOQUEADO: a chave configurada é SECRETA (sb_secret_). Use somente a chave publicável no navegador e gere uma nova chave secreta no Supabase, pois esta foi exposta.';
    }
    const parts = key.split('.');
    if (parts.length === 3) {
      try {
        const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
        if (payload.role === 'service_role') {
          return 'BLOQUEADO: a chave configurada é a service_role. Use a chave anon/publicável e rotacione a service_role no Supabase, pois ela foi exposta.';
        }
      } catch (_) { /* chave não-JWT: segue */ }
    }
    return null;
  }

  const problem = configProblem();
  const client = problem ? null : window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

  const PERMS = {
    'clientes.write': ['admin', 'gestor', 'operador'],
    'clientes.cpf': ['admin', 'gestor', 'operador'],
    'clientes.anonimizar': ['admin'],
    'contratos.write': ['admin', 'gestor'],
    'contratos.cancelar': ['admin'],
    'pagamentos.write': ['admin', 'gestor', 'operador'],
    'pagamentos.estornar': ['admin', 'gestor'],
    'caixa.write': ['admin', 'gestor'],
    'config.write': ['admin'],
    'auditoria.read': ['admin', 'gestor'],
  };

  const Auth = {
    client,
    problem,
    session: null,
    profile: null,
    org: null,

    can(action) {
      return !!(this.profile && PERMS[action] && PERMS[action].includes(this.profile.papel));
    },

    async loadProfile(userId) {
      const { data, error } = await client.from('profiles')
        .select('id, nome, email, papel, ativo, organizacao_id').eq('id', userId).maybeSingle();
      if (error) throw error;
      return data;
    },

    async loadOrg(orgId) {
      const { data, error } = await client.from('organizacoes').select('*').eq('id', orgId).maybeSingle();
      if (error) throw error;
      return data;
    },

    /** Exige sessão + perfil ativo + organização. Retorna o contexto, ou null (exibe o login). */
    async requireAuth() {
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      if (!data.session) return null;
      this.session = data.session;
      const profile = await this.loadProfile(data.session.user.id);
      if (!profile || !profile.ativo || !profile.organizacao_id) return null;
      this.profile = profile;
      this.org = await this.loadOrg(profile.organizacao_id);
      if (!this.org) return null;
      client.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_OUT') location.replace(location.pathname);
      });
      return { session: this.session, profile: this.profile, org: this.org };
    },

    async signOut() {
      try { await client.auth.signOut(); } finally { location.replace(location.pathname); }
    },
  };

  window.Auth = Auth;

  // ===========================================================================
  // Tela de login (seção #auth-screen do index.html)
  // ===========================================================================
  let loginIniciado = false;
  function initLoginPage(opts = {}) {
    if (loginIniciado) return;
    loginIniciado = true;
    const U = window.U;
    const $ = (sel) => document.querySelector(sel);
    const views = ['loading', 'login', 'signup', 'forgot', 'reset', 'onboarding', 'config'];
    const show = (name) => views.forEach((v) => $('#view-' + v).classList.toggle('hidden', v !== name));
    const loginUrl = location.origin + location.pathname;
    document.getElementById('auth-screen').classList.remove('hidden');
    document.body.classList.remove('auth-pending');

    if (problem) {
      $('#config-error').textContent = problem;
      show('config');
      return;
    }

    let recovering = !!opts.recovery;
    if (recovering) show('reset');
    client.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') { recovering = true; show('reset'); }
    });

    async function routeAfterLogin() {
      const { data } = await client.auth.getSession();
      if (!data.session || recovering) return false;
      const profile = await Auth.loadProfile(data.session.user.id);
      if (profile && profile.ativo && profile.organizacao_id) {
        window.App.start();
        return true;
      }
      $('#onb-email').textContent = data.session.user.email || '';
      $('#onb-inactive').classList.toggle('hidden', !(profile && profile.organizacao_id && !profile.ativo));
      $('#onb-create').classList.toggle('hidden', !!(profile && profile.organizacao_id));
      show('onboarding');
      return true;
    }

    document.querySelectorAll('[data-view]').forEach((b) =>
      b.addEventListener('click', () => show(b.dataset.view)));

    $('#form-login').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const btn = f.querySelector('button[type=submit]');
      const email = f.email.value.trim();
      const password = f.password.value;
      if (!U.validEmail(email) || !password) { U.toast('Informe e-mail e senha válidos.', 'error'); return; }
      U.busy(btn, true);
      const { error } = await client.auth.signInWithPassword({ email, password });
      U.busy(btn, false);
      if (error) {
        U.toast(/invalid login/i.test(error.message) ? 'E-mail ou senha incorretos.' :
                /not confirmed/i.test(error.message) ? 'Confirme seu e-mail antes de entrar.' : U.errorMessage(error), 'error');
        return;
      }
      f.password.value = '';
      try { await routeAfterLogin(); } catch (err) { U.toast(U.errorMessage(err), 'error'); }
    });

    $('#form-signup').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const btn = f.querySelector('button[type=submit]');
      const nome = f.nome.value.trim();
      const email = f.email.value.trim();
      const password = f.password.value;
      if (nome.length < 3) { U.toast('Informe seu nome completo.', 'error'); return; }
      if (!U.validEmail(email)) { U.toast('E-mail inválido.', 'error'); return; }
      if (!U.strongPassword(password)) { U.toast('A senha deve ter ao menos 8 caracteres, com letras e números.', 'error'); return; }
      if (password !== f.password2.value) { U.toast('As senhas não conferem.', 'error'); return; }
      U.busy(btn, true);
      const { data, error } = await client.auth.signUp({
        email, password, options: { data: { nome }, emailRedirectTo: loginUrl },
      });
      U.busy(btn, false);
      if (error) {
        U.toast(/signups not allowed/i.test(error.message)
          ? 'O cadastro público está desativado. Solicite acesso ao administrador.' : U.errorMessage(error), 'error');
        return;
      }
      f.reset();
      if (data.session) { await routeAfterLogin(); return; }
      U.toast('Cadastro realizado. Verifique seu e-mail para confirmar a conta e depois faça login.', 'success', 9000);
      show('login');
    });

    $('#form-forgot').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const btn = f.querySelector('button[type=submit]');
      const email = f.email.value.trim();
      if (!U.validEmail(email)) { U.toast('E-mail inválido.', 'error'); return; }
      U.busy(btn, true);
      const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: loginUrl });
      U.busy(btn, false);
      if (error) { U.toast(U.errorMessage(error), 'error'); return; }
      U.toast('Se o e-mail estiver cadastrado, você receberá um link para redefinir a senha.', 'success', 9000);
      show('login');
    });

    $('#form-reset').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const btn = f.querySelector('button[type=submit]');
      if (!U.strongPassword(f.password.value)) { U.toast('A senha deve ter ao menos 8 caracteres, com letras e números.', 'error'); return; }
      if (f.password.value !== f.password2.value) { U.toast('As senhas não conferem.', 'error'); return; }
      U.busy(btn, true);
      const { error } = await client.auth.updateUser({ password: f.password.value });
      U.busy(btn, false);
      if (error) { U.toast(U.errorMessage(error), 'error'); return; }
      f.reset();
      recovering = false;
      U.toast('Senha alterada com sucesso.', 'success');
      await routeAfterLogin();
    });

    $('#form-org').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const btn = f.querySelector('button[type=submit]');
      const nome = f.nome.value.trim();
      const cnpj = U.digits(f.cnpj.value);
      if (nome.length < 2) { U.toast('Informe o nome da organização.', 'error'); return; }
      if (cnpj && cnpj.length !== 14) { U.toast('CNPJ deve ter 14 dígitos.', 'error'); return; }
      U.busy(btn, true);
      const { error } = await client.rpc('criar_organizacao', { p_nome: nome, p_cnpj: cnpj || null });
      U.busy(btn, false);
      if (error) { U.toast(U.errorMessage(error), 'error'); return; }
      U.toast('Organização criada. Você é o administrador.', 'success');
      history.replaceState(null, '', '#configuracoes');
      window.App.start();
    });

    $('#btn-recheck').addEventListener('click', async (e) => {
      U.busy(e.currentTarget, true);
      try {
        const routed = await routeAfterLogin();
        if (!routed) show('login');
        else if (!$('#view-onboarding').classList.contains('hidden')) U.toast('Seu usuário ainda não foi vinculado a uma organização.', 'warning');
      } catch (err) { U.toast(U.errorMessage(err), 'error'); }
      U.busy(e.currentTarget, false);
    });

    $('#btn-logout-onb').addEventListener('click', async () => {
      await client.auth.signOut();
      show('login');
    });

    // Aguarda o Supabase processar links de confirmação/recuperação na URL.
    setTimeout(async () => {
      try {
        if (!(await routeAfterLogin()) && !recovering) show('login');
      } catch (err) {
        U.toast(U.errorMessage(err), 'error');
        show('login');
      }
    }, 150);
  }

  Auth.showLogin = initLoginPage;
})();

/* ==========================================================================
 * app.js
 * ========================================================================== */
/*
 * app.js — Utilitários compartilhados: layout, formatação, validação,
 * mensagens, modais, tabela paginada e gráficos.
 */
(function () {
  'use strict';

  const cfg = window.APP_CONFIG || {};
  const TZ = cfg.TIMEZONE || 'America/Sao_Paulo';
  const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

  // ---------------------------------------------------------------- ícones
  const ICONS = {
    grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
    users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
    check: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
    trend: '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>',
    bars: '<line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/>',
    sliders: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
    menu: '<line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
    search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
    plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    inbox: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
    alert: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
    printer: '<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  };

  // ---------------------------------------------------------------- rótulos
  const LABELS = {
    papel: { admin: 'Administrador', gestor: 'Gestor', operador: 'Operador', consulta: 'Consulta' },
    clienteStatus: { ativo: ['Ativo', 'success'], inativo: ['Inativo', 'neutral'], arquivado: ['Arquivado', 'neutral'] },
    contratoStatus: { pendente_assinatura: ['Aguardando assinatura', 'warning'], ativo: ['Ativo', 'info'], quitado: ['Quitado', 'success'], renegociado: ['Renegociado', 'warning'], cancelado: ['Cancelado', 'neutral'] },
    parcelaStatus: { aberta: ['Em aberto', 'info'], parcial: ['Parcial', 'warning'], paga: ['Paga', 'success'], renegociada: ['Renegociada', 'neutral'], cancelada: ['Cancelada', 'neutral'] },
    situacao: { vencida: ['Vencida', 'danger'], a_vencer: ['Vence em breve', 'warning'], em_dia: ['Em dia', 'info'], paga: ['Paga', 'success'], renegociada: ['Renegociada', 'neutral'], cancelada: ['Cancelada', 'neutral'] },
    pagamentoStatus: { confirmado: ['Confirmado', 'success'], estornado: ['Estornado', 'danger'] },
    movSituacao: { realizado: ['Realizado', 'success'], previsto: ['Previsto', 'info'], cancelado: ['Cancelado', 'neutral'] },
    forma: { pix: 'PIX', dinheiro: 'Dinheiro', transferencia: 'Transferência', boleto: 'Boleto', cartao: 'Cartão', outro: 'Outro' },
    frequencia: { mensal: 'Mensal', quinzenal: 'Quinzenal', semanal: 'Semanal' },
    sistema: { PRICE: 'Price (parcelas fixas)', SAC: 'SAC (amortização constante)' },
    categoria: {
      liberacao_credito: 'Liberação de crédito', recebimento_principal: 'Recebimento de principal',
      recebimento_juros: 'Recebimento de juros', recebimento_encargos: 'Recebimento de encargos',
      estorno_recebimento: 'Estorno de recebimento', cancelamento_liberacao: 'Cancelamento de liberação',
      despesa_operacional: 'Despesa operacional', aporte: 'Aporte de capital', retirada: 'Retirada',
      outras_entradas: 'Outras entradas', outras_saidas: 'Outras saídas',
    },
    origem: { manual: 'Manual', contrato: 'Contrato', pagamento: 'Pagamento', estorno: 'Estorno' },
  };

  // ---------------------------------------------------------------- utilitários
  const U = {
    LABELS,

    icon(name) {
      return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
    },

    esc(v) {
      if (v === null || v === undefined) return '';
      return String(v).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    },

    money(v) {
      if (v === null || v === undefined || v === '') return '—';
      return brl.format(typeof v === 'bigint' ? Number(v) / 100 : Number(v));
    },

    pct(fraction, digits = 2) {
      if (fraction === null || fraction === undefined || fraction === '' || Number.isNaN(Number(fraction))) return '—';
      return (Number(fraction) * 100).toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits }) + '%';
    },

    int(v) { return Number(v || 0).toLocaleString('pt-BR'); },

    date(iso) {
      if (!iso) return '—';
      const [y, m, d] = String(iso).slice(0, 10).split('-');
      return `${d}/${m}/${y}`;
    },

    datetime(ts) {
      if (!ts) return '—';
      return new Date(ts).toLocaleString('pt-BR', { timeZone: TZ, dateStyle: 'short', timeStyle: 'short' });
    },

    today() {
      return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    },

    monthStart(iso) { return String(iso).slice(0, 8) + '01'; },

    monthEnd(iso) {
      const [y, m] = String(iso).split('-').map(Number);
      const d = new Date(Date.UTC(y, m, 0)).getUTCDate();
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    },

    monthLabel(ym) {
      const names = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
      const [y, m] = String(ym).split('-');
      return `${names[Number(m) - 1]}/${y.slice(2)}`;
    },

    digits(s) { return String(s || '').replace(/\D/g, ''); },

    /** "1.234,56" | "1234,56" | "1234.56" → "1234.56"; null se inválido. */
    parseMoney(input) {
      let s = String(input || '').replace(/[R$\s]/g, '');
      if (!s) return null;
      if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
      else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
      if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
      return s;
    },

    /** "2,5" → "2.5" (até 6 casas decimais); null se inválido. */
    parsePercent(input) {
      let s = String(input || '').replace(/[%\s]/g, '').replace(',', '.');
      if (!/^\d+(\.\d{1,6})?$/.test(s)) return null;
      return s;
    },

    moneyInput(v) {
      if (v === null || v === undefined || v === '') return '';
      return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    },

    formatCPF(d) {
      d = U.digits(d);
      return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : d;
    },

    formatCNPJ(d) {
      d = U.digits(d);
      return d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : d;
    },

    formatPhone(d) {
      d = U.digits(d);
      if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
      if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
      return d || '—';
    },

    validCPF(v) {
      const d = U.digits(v);
      if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
      const calc = (len) => {
        let s = 0;
        for (let i = 0; i < len; i++) s += Number(d[i]) * (len + 1 - i);
        const r = (s * 10) % 11;
        return r === 10 ? 0 : r;
      };
      return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
    },

    validEmail(v) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(v || '')); },

    strongPassword(v) { return typeof v === 'string' && v.length >= 8 && /[A-Za-z]/.test(v) && /\d/.test(v); },

    /** Remove caracteres com significado nos filtros do PostgREST. */
    sanitizeSearch(q) { return String(q || '').replace(/[,()*%\\:"']/g, ' ').trim().slice(0, 60); },

    debounce(fn, ms = 350) {
      let t;
      return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
    },

    badge(text, variant = 'neutral') { return `<span class="badge badge-${variant}">${U.esc(text)}</span>`; },

    statusBadge(map, value) {
      const entry = LABELS[map][value];
      return entry ? U.badge(entry[0], entry[1]) : U.badge(value || '—');
    },

    // ------------------------------------------------------------ estados
    loadingHTML(text = 'Carregando...') {
      return `<div class="state"><span class="spinner"></span><div class="mt-1">${U.esc(text)}</div></div>`;
    },
    emptyHTML(title = 'Nenhum registro encontrado', text = '') {
      return `<div class="state">${U.icon('inbox')}<div class="state-title">${U.esc(title)}</div>${text ? `<div>${U.esc(text)}</div>` : ''}</div>`;
    },
    errorHTML(msg, retry = true) {
      return `<div class="state state-error">${U.icon('alert')}<div class="state-title">Não foi possível carregar</div><div>${U.esc(msg)}</div>${retry ? '<button class="btn btn-sm mt-1" data-action="retry">Tentar novamente</button>' : ''}</div>`;
    },

    // ------------------------------------------------------------ erros
    errorMessage(err) {
      if (!err) return 'Erro desconhecido.';
      const code = err.code || '';
      const msg = err.message || String(err);
      if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return 'Falha de conexão com o servidor. Verifique sua internet e tente novamente.';
      if (code === 'PGRST301' || /JWT expired/i.test(msg)) return 'Sua sessão expirou. Faça login novamente.';
      if (code === 'PGRST202') return 'Função não encontrada no banco. Verifique se o arquivo schema.sql foi executado.';
      if (code === '42P01' || code === 'PGRST205') return 'Estrutura do banco não encontrada. Execute o arquivo schema.sql.';
      if (code === '42501' && /permission denied|row-level security/i.test(msg)) return 'Você não tem permissão para esta operação.';
      if (code === '23505') return /cpf/i.test(msg) ? 'Já existe um cliente com este CPF.' : 'Registro duplicado.';
      if (code === '23514' && /violates check constraint/i.test(msg)) return 'Dados inválidos: verifique os campos informados.';
      if (code === 'CG001' || code === 'CG002') return msg.replace(/^[A-Z_]+:\s*/, '');
      return msg;
    },

    // ------------------------------------------------------------ feedback
    toast(message, type = 'info', timeout = 5500) {
      let root = document.getElementById('toast-root');
      if (!root) {
        root = document.createElement('div');
        root.id = 'toast-root';
        document.body.appendChild(root);
      }
      root.className = 'toast-root';
      root.setAttribute('aria-live', 'polite');
      const el = document.createElement('div');
      el.className = `toast toast-${type}`;
      el.setAttribute('role', type === 'error' ? 'alert' : 'status');
      el.innerHTML = `<div class="toast-msg"></div><button type="button" aria-label="Fechar">&times;</button>`;
      el.querySelector('.toast-msg').textContent = message;
      el.querySelector('button').addEventListener('click', () => el.remove());
      root.appendChild(el);
      if (timeout) setTimeout(() => el.remove(), timeout);
    },

    busy(btn, on, label) {
      if (!btn) return;
      if (on) {
        btn.dataset.label = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = `<span class="spinner"></span> ${U.esc(label || 'Aguarde...')}`;
      } else if (btn.dataset.label !== undefined) {
        btn.disabled = false;
        btn.innerHTML = btn.dataset.label;
        delete btn.dataset.label;
      }
    },

    // ------------------------------------------------------------ modais
    modal({ title, body = '', footer = '', size = '', onClose } = {}) {
      const dlg = document.createElement('dialog');
      dlg.className = `modal ${size ? 'modal-' + size : ''}`;
      dlg.innerHTML = `<div class="modal-inner">
        <div class="modal-header"><h2></h2><button type="button" class="icon-btn" data-close aria-label="Fechar">${U.icon('x')}</button></div>
        <div class="modal-body">${body}</div>
        ${footer ? `<div class="modal-footer">${footer}</div>` : ''}
      </div>`;
      dlg.querySelector('h2').textContent = title || '';
      document.body.appendChild(dlg);
      // A limpeza não depende só do evento "close" (alguns navegadores embutidos não o disparam).
      let finalizado = false;
      const finalizar = () => {
        if (finalizado) return;
        finalizado = true;
        dlg.remove();
        document.body.classList.remove('printing-modal');
        if (onClose) onClose();
      };
      const close = () => { if (dlg.open) dlg.close(); finalizar(); };
      dlg.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(); });
      dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); }); // tecla Esc
      dlg.addEventListener('close', finalizar);
      dlg._fechar = close;
      dlg.showModal();
      return { el: dlg, body: dlg.querySelector('.modal-body'), footer: dlg.querySelector('.modal-footer'), close };
    },

    /**
     * Confirmação. Opções: message, confirmText, danger, reason {label, minLength}.
     * Resolve com null (cancelado) ou { reason }.
     */
    confirm({ title = 'Confirmar', message = '', confirmText = 'Confirmar', danger = false, reason = null, html = false } = {}) {
      return new Promise((resolve) => {
        let result = null;
        const reasonField = reason ? `<div class="field mt-2"><label for="cf-reason">${U.esc(reason.label || 'Justificativa')} <span class="req">*</span></label>
          <textarea id="cf-reason" maxlength="1000" placeholder="${U.esc(reason.placeholder || '')}"></textarea>
          <span class="hint">Mínimo de ${reason.minLength || 10} caracteres.</span><span class="error-msg"></span></div>` : '';
        const m = U.modal({
          title,
          body: `<div class="cf-message">${html ? message : `<p>${U.esc(message)}</p>`}</div>${reasonField}`,
          footer: `<button type="button" class="btn" data-close>Cancelar</button>
                   <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${U.esc(confirmText)}</button>`,
          onClose: () => resolve(result),
        });
        m.el.querySelector('[data-ok]').addEventListener('click', () => {
          if (reason) {
            const ta = m.el.querySelector('#cf-reason');
            const v = ta.value.trim();
            if (v.length < (reason.minLength || 10)) {
              const f = ta.closest('.field');
              f.classList.add('invalid');
              f.querySelector('.error-msg').textContent = `Informe ao menos ${reason.minLength || 10} caracteres.`;
              ta.focus();
              return;
            }
            result = { reason: v };
          } else {
            result = { reason: null };
          }
          m.close();
        });
      });
    },

    // ------------------------------------------------------------ formulários
    fieldError(form, name, message) {
      const input = form.elements[name];
      const field = input && (input.closest ? input.closest('.field') : null);
      if (!field) return;
      field.classList.add('invalid');
      let em = field.querySelector('.error-msg');
      if (!em) { em = document.createElement('span'); em.className = 'error-msg'; field.appendChild(em); }
      em.textContent = message;
    },

    clearErrors(form) { form.querySelectorAll('.field.invalid').forEach((f) => f.classList.remove('invalid')); },

    focusFirstError(form) {
      const f = form.querySelector('.field.invalid input, .field.invalid select, .field.invalid textarea');
      if (f) f.focus();
    },

    options(map, selected, { empty } = {}) {
      const entries = Object.entries(map).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]);
      return (empty !== undefined ? `<option value="">${U.esc(empty)}</option>` : '') +
        entries.map(([k, v]) => `<option value="${U.esc(k)}"${String(selected) === k ? ' selected' : ''}>${U.esc(v)}</option>`).join('');
    },

    // ------------------------------------------------------------ exportação
    downloadCSV(filename, headers, rows) {
      const cell = (v) => {
        let s = v === null || v === undefined ? '' : String(v);
        if (/^[=+\-@]/.test(s)) s = "'" + s; // evita injeção de fórmulas em planilhas
        return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const csv = '﻿' + [headers, ...rows].map((r) => r.map(cell).join(';')).join('\r\n');
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },

    csvNumber(v) { return v === null || v === undefined ? '' : String(v).replace('.', ','); },

    printModal() {
      document.body.classList.add('printing-modal');
      window.print();
      setTimeout(() => document.body.classList.remove('printing-modal'), 500);
    },

    // ------------------------------------------------------------ gráficos
    charts: new Map(),
    chart(canvas, config) {
      if (!canvas) return null;
      if (!window.Chart) {
        canvas.parentElement.innerHTML = U.errorHTML('A biblioteca de gráficos não carregou.', false);
        return null;
      }
      const prev = U.charts.get(canvas);
      if (prev) prev.destroy();
      const c = new window.Chart(canvas, config);
      U.charts.set(canvas, c);
      // Garante o tamanho correto caso o layout ainda não estivesse estável na criação.
      requestAnimationFrame(() => { if (c.canvas) c.resize(); });
      return c;
    },
    chartMoneyTicks: { callback: (v) => 'R$ ' + Number(v).toLocaleString('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }) },
    chartMoneyTooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${brl.format(ctx.parsed.y ?? ctx.parsed)}` } },
    COLORS: { primary: '#1f4e8c', accent: '#0f8a7e', success: '#1a7f4b', warning: '#d08a1c', danger: '#b42318', muted: '#9aa7bb', info: '#5b8fd6' },

    async rpc(fn, params) {
      const { data, error } = await Auth.client.rpc(fn, params);
      if (error) throw error;
      return data;
    },

    // ------------------------------------------------------------ nota promissória
    /**
     * Uma nota promissória (modelo tradicional) para a parcela p.
     * d = { organizacao, cliente, contrato, assinatura } (formato de _dados_notas no banco).
     */
    notaPromissoria(d, p) {
      const F = window.Finance;
      const { organizacao: org, cliente: cli, contrato: ct, assinatura: ass } = d;
      const esc = U.esc;
      const v = F.dataPorExtenso(String(p.vencimento));
      const ext = F.valorPorExtenso(String(p.valor));
      const palavras = ext.split(' ');
      let linha1 = '';
      while (palavras.length && `${linha1} ${palavras[0]}`.trim().length <= 54) linha1 = `${linha1} ${palavras.shift()}`.trim();
      const linha2 = palavras.join(' ');
      const valor = Number(p.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const dias = v.dia === 1 ? 'primeiro dia' : `${v.diaExtenso} dias`;
      const assinada = ass && ass.status === 'assinado' && ass.assinatura_imagem;
      return `<div class="np-wrap"><article class="np" aria-label="Nota promissória ${p.numero} de ${ct.qtd_parcelas}">
        <div class="np-aval" aria-hidden="true">
          <span class="np-aval-title">AVALISTAS</span>
          <span class="np-aval-brasao">REPÚBLICA FEDERATIVA DO BRASIL</span>
          <span class="np-aval-col">CPF/CNPJ</span><span class="np-aval-col">ENDEREÇO</span>
          <span class="np-aval-col">CPF/CNPJ</span><span class="np-aval-col">ENDEREÇO</span>
        </div>
        <div class="np-main">
          <div class="np-row"><b class="np-big">Nº</b><span class="np-box np-num">${p.numero}/${ct.qtd_parcelas}</span>
            <span>Vencimento</span><span class="np-fill np-w3">${v.dia}</span><span>de</span>
            <span class="np-fill np-grow">${esc(v.mes)}</span><span>de</span><span class="np-fill np-w4">${v.ano}</span>
            <b class="np-big">R$</b><span class="np-box np-valor">${valor}</span></div>
          <div class="np-row"><span>Ao(s)</span><span class="np-fill np-grow">${esc(dias)} do mês de ${esc(v.mes)} do ano de ${esc(v.anoExtenso)}</span></div>
          <div class="np-row"><span class="np-fill np-grow">(${U.date(p.vencimento)})</span><span>pagar</span><span class="np-fill np-w5">ei</span>
            <span>por esta única via de</span><b class="np-titulo">NOTA PROMISSÓRIA</b></div>
          <div class="np-row"><span>a</span><span class="np-fill np-grow">${esc(org.nome)}</span>
            <span>CPF/CNPJ</span><span class="np-fill np-w14">${esc(U.formatCNPJ(org.cnpj || ''))}</span></div>
          <div class="np-row"><span>Ou à sua ordem, a quantia de</span><span class="np-box np-grow">${esc(linha1)}</span></div>
          <div class="np-row"><span class="np-box np-grow">${esc(linha2 || '* * *')}</span></div>
          <div class="np-row"><span>em moeda corrente deste país, pagável em</span><span class="np-fill np-grow">${esc(org.praca_pagamento || '')}</span></div>
          <div class="np-row np-small"><span>EMITENTE</span><span class="np-fill np-grow">${esc(cli.nome)}</span>
            <span>DATA DA EMISSÃO</span><span class="np-fill np-w8">${U.date(ct.data_contratacao)}</span></div>
          <div class="np-row np-small"><span>CPF/CNPJ</span><span class="np-fill np-w14">${esc(U.formatCPF(cli.cpf || ''))}</span>
            <span>ENDEREÇO</span><span class="np-fill np-grow">${esc(cli.endereco || '')}</span></div>
          <div class="np-row np-small"><span class="np-fill np-grow np-sign">${assinada
            ? `<img src="${esc(ass.assinatura_imagem)}" alt="Assinatura de ${esc(ass.nome_assinante || cli.nome)}">` : ''}</span>
            <span>ASS. DO EMITENTE</span></div>
        </div>
      </article></div>`;
    },

    /** Todas as notas promissórias do contrato. */
    notasPromissorias(d) {
      return `<div class="np-list">${(d.parcelas || []).map((p) => U.notaPromissoria(d, p)).join('')}</div>`;
    },

    /** Mensagem de WhatsApp com o link de assinatura. */
    mensagemAssinatura({ cliente, org, contrato, link, expira }) {
      const nome = String(cliente.nome || '').split(' ')[0];
      return `Olá, ${nome}! Tudo bem?\n\n` +
        `Segue o link para você conferir e assinar o contrato nº ${contrato.numero} com ${org.nome}:\n\n` +
        `• Valor: ${U.money(contrato.principal)}\n` +
        `• Parcelas: ${contrato.qtd_parcelas}x de ${U.money(contrato.valor_parcela)} (1º vencimento em ${U.date(contrato.primeiro_vencimento)})\n` +
        `• Total a pagar: ${U.money(contrato.total_projetado)}\n\n` +
        `No link aparecem as notas promissórias de cada parcela. Para assinar, confirme seu CPF e desenhe sua assinatura.\n\n` +
        `${link}\n\n` +
        `O link é válido até ${U.datetime(expira)}.`;
    },

    /** Link wa.me para o telefone do cliente (DDD + número, 10 ou 11 dígitos). */
    whatsappUrl(telefone, mensagem) {
      const d = U.digits(telefone);
      if (d.length < 10 || d.length > 11) return null;
      return `https://wa.me/55${d}?text=${encodeURIComponent(mensagem)}`;
    },

    /** Mensagem de WhatsApp com o link do comprovante (um ou vários pagamentos do mesmo contrato). */
    mensagemComprovante({ cliente, pagamentos, link }) {
      const nome = String(cliente.nome || '').split(' ')[0];
      const g = pagamentos[0];
      const total = pagamentos.reduce((a, x) => a + Number(x.valor), 0);
      const corpo = pagamentos.length === 1
        ? `• Contrato nº ${g.contrato_numero} — parcela ${g.parcela_numero}/${g.qtd_parcelas}\n` +
          `• Valor pago: ${U.money(g.valor)}\n• Data: ${U.date(g.data_pagamento)}\n\n` +
          `Seu comprovante (nota promissória da parcela, com o carimbo de pago):\n${link}`
        : `• Contrato nº ${g.contrato_numero} — ${pagamentos.length} parcelas (${pagamentos.map((x) => x.parcela_numero).join(', ')})\n` +
          `• Total pago: ${U.money(total)}\n• Data: ${U.date(g.data_pagamento)}\n\n` +
          `Seus comprovantes (notas promissórias das parcelas, com o carimbo de pago):\n${link}`;
      return `Olá, ${nome}! Confirmamos o recebimento do seu pagamento.\n\n${corpo}\n\nObrigado!`;
    },

    /** Janela de envio pelo WhatsApp: link copiável, mensagem editável e botão para abrir a conversa. */
    modalWhatsApp({ titulo, intro, link, mensagem, telefone, validade }) {
      const esc = U.esc;
      const m = U.modal({
        title: titulo,
        size: 'lg',
        body: `${intro ? `<p>${intro}</p>` : ''}
          <div class="field mb-2"><label for="wa-link">Link</label>
            <div class="link-box"><input type="text" id="wa-link" readonly value="${esc(link)}">
            <button type="button" class="btn" data-copy="link">Copiar</button></div>
            ${validade ? `<span class="hint">${esc(validade)}</span>` : ''}</div>
          <div class="field"><label for="wa-msg">Mensagem</label>
            <textarea id="wa-msg" rows="11">${esc(mensagem)}</textarea>
            <span class="hint">Você pode editar a mensagem antes de enviar.</span></div>
          ${telefone ? `<p class="small muted mt-1">WhatsApp do cliente: <strong>${esc(U.formatPhone(telefone))}</strong></p>`
            : `<div class="alert alert-warning mt-1">Este cliente não tem telefone cadastrado. Cadastre em Clientes → Editar, ou copie a mensagem e envie por outro meio.</div>`}`,
        footer: `<button type="button" class="btn" data-close>Fechar</button>
          <button type="button" class="btn" data-copy="msg">Copiar mensagem</button>
          ${telefone ? '<a class="btn btn-whatsapp" data-wa target="_blank" rel="noopener noreferrer">Enviar pelo WhatsApp</a>' : ''}`,
      });
      const ta = m.el.querySelector('#wa-msg');
      const wa = m.el.querySelector('[data-wa]');
      const atualizar = () => { if (wa) wa.href = U.whatsappUrl(telefone, ta.value) || '#'; };
      ta.addEventListener('input', atualizar);
      atualizar();
      m.el.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
        const texto = b.dataset.copy === 'link' ? link : ta.value;
        try {
          await navigator.clipboard.writeText(texto);
        } catch (_) {
          const el = b.dataset.copy === 'link' ? m.el.querySelector('#wa-link') : ta;
          el.select();
          document.execCommand('copy');
        }
        U.toast(b.dataset.copy === 'link' ? 'Link copiado.' : 'Mensagem copiada.', 'success', 2500);
      }));
      return m;
    },
  };

  // ---------------------------------------------------------------- tabela paginada
  class DataTable {
    /**
     * opts: container, columns [{key,label,render,className}], fetch async ({page,pageSize,from,to,search,filters}) → {rows,total},
     *       filters [{key,label,type:'select'|'date',options,value}], search (bool), searchPlaceholder,
     *       onAction(action, row, button), rowClass(row), emptyTitle, emptyText, toolbarRight (html)
     */
    constructor(opts) {
      this.o = Object.assign({ pageSize: cfg.PAGE_SIZE || 15, search: true, searchPlaceholder: 'Buscar...', filters: [],
        emptyTitle: 'Nenhum registro encontrado', emptyText: '' }, opts);
      this.page = 1;
      this.search = '';
      this.filters = {};
      this.rows = [];
      this.total = 0;
      this.reqId = 0;
      this.o.filters.forEach((f) => { this.filters[f.key] = f.value !== undefined ? f.value : ''; });
      this.render();
    }

    render() {
      const o = this.o;
      const filtersHTML = o.filters.map((f) => {
        if (f.type === 'date') {
          return `<label class="sr-only" for="flt-${f.key}">${U.esc(f.label)}</label>
            <input type="date" id="flt-${f.key}" data-filter="${f.key}" value="${U.esc(this.filters[f.key])}" title="${U.esc(f.label)}">`;
        }
        return `<label class="sr-only" for="flt-${f.key}">${U.esc(f.label)}</label>
          <select id="flt-${f.key}" data-filter="${f.key}">${f.options.map((op) =>
            `<option value="${U.esc(op.value)}"${String(this.filters[f.key]) === String(op.value) ? ' selected' : ''}>${U.esc(op.label)}</option>`).join('')}</select>`;
      }).join('');
      o.container.innerHTML = `
        <div class="table-toolbar">
          ${o.search ? `<div class="search">${U.icon('search')}<input type="search" placeholder="${U.esc(o.searchPlaceholder)}" aria-label="Buscar" maxlength="60"></div>` : ''}
          ${filtersHTML}
          <div class="spacer"></div>
          ${o.toolbarRight || ''}
        </div>
        <div class="table-wrap"><table class="table responsive">
          <thead><tr>${o.columns.map((c) => `<th class="${c.className || ''}">${U.esc(c.label)}</th>`).join('')}</tr></thead>
          <tbody></tbody>
        </table></div>
        <div class="pagination"></div>`;
      this.tbody = o.container.querySelector('tbody');
      this.pager = o.container.querySelector('.pagination');

      const search = o.container.querySelector('.table-toolbar input[type=search]');
      if (search) {
        search.addEventListener('input', U.debounce(() => { this.search = search.value.trim(); this.page = 1; this.load(); }));
      }
      o.container.querySelectorAll('[data-filter]').forEach((el) => el.addEventListener('change', () => {
        this.filters[el.dataset.filter] = el.value;
        this.page = 1;
        this.load();
      }));
      this.tbody.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        if (btn.dataset.action === 'retry') { this.load(); return; }
        const tr = btn.closest('tr[data-idx]');
        if (tr && o.onAction) o.onAction(btn.dataset.action, this.rows[Number(tr.dataset.idx)], btn);
      });
      this.pager.addEventListener('click', (e) => {
        const b = e.target.closest('[data-page]');
        if (!b || b.disabled) return;
        this.page = Number(b.dataset.page);
        this.load();
      });
    }

    colspan(html) { return `<tr><td colspan="${this.o.columns.length}">${html}</td></tr>`; }

    async load() {
      const id = ++this.reqId;
      const { pageSize } = this.o;
      this.tbody.innerHTML = this.colspan(U.loadingHTML());
      this.pager.innerHTML = '';
      try {
        const from = (this.page - 1) * pageSize;
        const res = await this.o.fetch({ page: this.page, pageSize, from, to: from + pageSize - 1,
                                         search: U.sanitizeSearch(this.search), filters: Object.assign({}, this.filters) });
        if (id !== this.reqId) return;
        this.rows = res.rows || [];
        this.total = res.total || 0;
        if (!this.rows.length && this.page > 1 && this.total > 0) { this.page = 1; this.load(); return; }
        this.renderRows();
        this.renderPager();
        if (this.o.onLoaded) this.o.onLoaded(this.rows, this.total);
      } catch (err) {
        if (id !== this.reqId) return;
        console.error(err);
        this.tbody.innerHTML = this.colspan(U.errorHTML(U.errorMessage(err)));
      }
    }

    reload() { return this.load(); }

    renderRows() {
      const o = this.o;
      if (!this.rows.length) { this.tbody.innerHTML = this.colspan(U.emptyHTML(o.emptyTitle, o.emptyText)); return; }
      this.tbody.innerHTML = this.rows.map((r, i) => `<tr data-idx="${i}" class="${o.rowClass ? o.rowClass(r) : ''}">${
        o.columns.map((c) => `<td data-label="${U.esc(c.label)}" class="${c.className || ''}">${c.render ? c.render(r) : U.esc(r[c.key])}</td>`).join('')
      }</tr>`).join('');
    }

    renderPager() {
      const pages = Math.max(1, Math.ceil(this.total / this.o.pageSize));
      const start = this.total ? (this.page - 1) * this.o.pageSize + 1 : 0;
      const end = Math.min(this.total, this.page * this.o.pageSize);
      let lo = Math.max(1, this.page - 2);
      const hi = Math.min(pages, lo + 4);
      lo = Math.max(1, hi - 4);
      let nums = '';
      for (let p = lo; p <= hi; p++) {
        nums += `<button class="btn btn-sm ${p === this.page ? 'btn-primary' : ''}" data-page="${p}" aria-label="Página ${p}">${p}</button>`;
      }
      this.pager.innerHTML = `<div>Mostrando ${start}–${end} de ${U.int(this.total)}</div>
        <div class="pages">
          <button class="btn btn-sm" data-page="${this.page - 1}" ${this.page <= 1 ? 'disabled' : ''}>Anterior</button>
          ${nums}
          <button class="btn btn-sm" data-page="${this.page + 1}" ${this.page >= pages ? 'disabled' : ''}>Próxima</button>
        </div>`;
    }
  }

  // ---------------------------------------------------------------- layout
  const NAV = [
    { id: 'dashboard', href: '#dashboard', label: 'Painel', icon: 'grid' },
    { id: 'clientes', href: '#clientes', label: 'Clientes', icon: 'users' },
    { id: 'contratos', href: '#contratos', label: 'Contratos', icon: 'file' },
    { id: 'parcelas', href: '#parcelas', label: 'Parcelas', icon: 'calendar' },
    { id: 'pagamentos', href: '#pagamentos', label: 'Pagamentos', icon: 'check' },
    { id: 'fluxo-caixa', href: '#fluxo-caixa', label: 'Fluxo de caixa', icon: 'trend' },
    { id: 'relatorios', href: '#relatorios', label: 'Relatórios', icon: 'bars' },
    { id: 'configuracoes', href: '#configuracoes', label: 'Configurações', icon: 'sliders' },
  ];

  /** Monta menu lateral e cabeçalho (uma única vez após o login). */
  function renderShell(ctx) {
    const sidebar = document.getElementById('sidebar');
    const topbar = document.getElementById('topbar');
    const appName = cfg.APP_NAME || 'CrediGestor';

    sidebar.className = 'sidebar';
    sidebar.innerHTML = `
      <div class="sidebar-brand"><span class="brand-mark">₢</span><span class="brand-name">${U.esc(appName)}</span></div>
      <nav class="sidebar-nav" aria-label="Menu principal">
        ${NAV.map((n) => `<a class="nav-item" data-nav="${n.id}" href="${n.href}" title="${U.esc(n.label)}">${U.icon(n.icon)}<span class="nav-label">${U.esc(n.label)}</span></a>`).join('')}
      </nav>
      <div class="sidebar-footer">Dados protegidos · LGPD</div>`;
    sidebar.addEventListener('click', (e) => { if (e.target.closest('.nav-item')) document.body.classList.remove('sidebar-open'); });

    const nome = ctx.profile.nome || ctx.profile.email;
    const initials = nome.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');
    topbar.className = 'topbar';
    topbar.innerHTML = `
      <button class="icon-btn" id="btn-toggle-sidebar" aria-label="Recolher/expandir menu">${U.icon('menu')}</button>
      <div class="topbar-title"></div>
      <div class="topbar-user">
        <div class="user-meta"><div class="name">${U.esc(nome)}</div>
          <div class="org">${U.esc(ctx.org.nome)} · ${U.esc(LABELS.papel[ctx.profile.papel] || ctx.profile.papel)}</div></div>
        <div class="avatar" title="${U.esc(ctx.profile.email)}">${U.esc(initials || '?')}</div>
        <button class="icon-btn" id="btn-logout" aria-label="Sair" title="Sair">${U.icon('logout')}</button>
      </div>`;

    if (localStorage.getItem('sidebar-collapsed') === '1') document.body.classList.add('sidebar-collapsed');
    document.getElementById('btn-toggle-sidebar').addEventListener('click', () => {
      if (window.matchMedia('(max-width: 900px)').matches) {
        document.body.classList.toggle('sidebar-open');
      } else {
        const c = document.body.classList.toggle('sidebar-collapsed');
        localStorage.setItem('sidebar-collapsed', c ? '1' : '0');
      }
    });
    const backdrop = document.querySelector('.sidebar-backdrop');
    if (backdrop) backdrop.addEventListener('click', () => document.body.classList.remove('sidebar-open'));
    document.getElementById('btn-logout').addEventListener('click', () => Auth.signOut());

  }

  function renderFatal(message) {
    document.body.classList.remove('auth-pending');
    document.body.innerHTML = `<div class="auth-body"><div class="auth-card">
      <div class="state state-error">${U.icon('alert')}<div class="state-title">Não foi possível iniciar o sistema</div>
      <p></p><a class="btn btn-primary mt-1" href="${U.esc(location.pathname)}">Tentar novamente</a></div></div></div>`;
    document.querySelector('.auth-card p').textContent = message;
  }

  // ---------------------------------------------------------------- assinatura do cliente (index.html#assinar?t=TOKEN)
  /** Campo para desenhar a assinatura com dedo ou mouse. */
  function signaturePad(canvas) {
    const ctx = canvas.getContext('2d');
    let desenhando = false;
    let vazio = true;
    let ultimo = null;
    const preparar = () => {
      const r = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineWidth = 2.4;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#10318a';
      vazio = true;
    };
    const pos = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    canvas.addEventListener('pointerdown', (e) => {
      desenhando = true;
      ultimo = pos(e);
      canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!desenhando) return;
      const p = pos(e);
      ctx.beginPath();
      ctx.moveTo(ultimo.x, ultimo.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      ultimo = p;
      vazio = false;
      e.preventDefault();
    });
    ['pointerup', 'pointercancel'].forEach((t) => canvas.addEventListener(t, () => { desenhando = false; }));
    preparar();
    return {
      limpar: preparar,
      vazio: () => vazio,
      /** PNG reduzido (até 600 px de largura) para não pesar no banco. */
      imagem() {
        const largura = Math.min(600, canvas.width);
        const out = document.createElement('canvas');
        out.width = largura;
        out.height = Math.round(largura * canvas.height / canvas.width);
        out.getContext('2d').drawImage(canvas, 0, 0, out.width, out.height);
        return out.toDataURL('image/png');
      },
    };
  }

  async function telaAssinatura(token) {
    ['auth-screen', 'tests-screen'].forEach((id) => { const e = document.getElementById(id); if (e) e.remove(); });
    const root = document.getElementById('public-screen');
    root.classList.remove('hidden');
    document.body.classList.remove('auth-pending');
    document.title = `Assinatura de contrato — ${cfg.APP_NAME || 'CrediGestor'}`;
    const falha = (msg) => {
      root.innerHTML = `<div class="public-wrap"><div class="card">${U.errorHTML(msg, false)}</div></div>`;
    };
    if (Auth.problem) { falha('Sistema temporariamente indisponível. Tente novamente mais tarde.'); return; }
    if (!/^[0-9a-f]{64}$/.test(token)) { falha('Link de assinatura inválido. Confira se copiou o endereço completo.'); return; }
    root.innerHTML = `<div class="public-wrap">${U.loadingHTML('Carregando contrato...')}</div>`;

    const carregar = async () => {
      try {
        render(await U.rpc('obter_assinatura', { p_token: token }));
      } catch (err) {
        falha(U.errorMessage(err));
      }
    };

    function render(d) {
      const esc = U.esc;
      const ct = d.contrato;
      const n = (d.parcelas || []).length;
      const assinado = d.assinatura && d.assinatura.status === 'assinado';
      const parcelas = d.parcelas || [];
      const valores = [...new Set(parcelas.map((p) => Number(p.valor).toFixed(2)))];
      const parcelaTxt = valores.length === 1 ? `${n}x de ${U.money(valores[0])}` : `${n} parcelas de ${U.money(parcelas[0].valor)} a ${U.money(parcelas[n - 1].valor)}`;
      const cetA = ct.cet_mensal === null ? null : window.Finance.annualFromMonthly(Number(ct.cet_mensal));
      root.innerHTML = `<div class="public-wrap">
        <header class="public-header"><span class="brand-mark">₢</span>
          <div><h1 class="mb-0">${esc(d.organizacao.nome)}</h1>
          <div class="muted">Contrato nº ${esc(ct.numero)} · ${assinado ? 'assinado' : 'aguardando sua assinatura'}</div></div></header>
        ${assinado
          ? `<div class="alert alert-success"><strong>Contrato assinado</strong> em ${esc(U.datetime(d.assinatura.assinado_em))}
              por ${esc(d.assinatura.nome_assinante)}. Guarde uma cópia das notas promissórias (botão "Imprimir / salvar PDF").</div>`
          : `<div class="alert alert-info">Confira o resumo e as notas promissórias abaixo. Para assinar, preencha seus dados no final da página.
              <button type="button" class="btn btn-sm btn-primary mt-1" id="btn-ir-assinar">Ir para a assinatura</button></div>`}
        <section class="card mb-2"><div class="card-header"><h2>Resumo do contrato</h2></div><div class="card-body">
          <div class="summary-grid">
            <div class="summary-item"><div class="label">Emitente</div><div class="value" style="font-size:.95rem">${esc(d.cliente.nome)}</div></div>
            <div class="summary-item"><div class="label">Valor liberado</div><div class="value">${U.money(ct.principal)}</div></div>
            <div class="summary-item"><div class="label">Parcelas</div><div class="value" style="font-size:.95rem">${esc(parcelaTxt)}</div></div>
            <div class="summary-item"><div class="label">Total a pagar</div><div class="value">${U.money(ct.total_projetado)}</div></div>
            <div class="summary-item"><div class="label">Juros</div><div class="value">${U.money(ct.total_juros)}</div></div>
            <div class="summary-item"><div class="label">Encargos</div><div class="value">${U.money(ct.encargos)}</div></div>
            <div class="summary-item"><div class="label">Taxa de juros</div><div class="value">${U.pct(ct.taxa_juros_mensal)} a.m.</div></div>
            <div class="summary-item"><div class="label">CET</div><div class="value">${ct.cet_mensal === null ? '—' : `${U.pct(ct.cet_mensal)} a.m.`}</div>
              <div class="small muted">${cetA === null ? '' : `${U.pct(cetA)} a.a.`}</div></div>
            <div class="summary-item"><div class="label">1º vencimento</div><div class="value">${U.date(parcelas.length ? parcelas[0].vencimento : ct.primeiro_vencimento)}</div></div>
          </div></div></section>
        <section class="np-print">
          <div class="page-header"><h2 class="mb-0">Notas promissórias (${n})</h2>
            <button type="button" class="btn no-print" id="btn-print">${U.icon('printer')} Imprimir / salvar PDF</button></div>
          <p class="small muted no-print">No celular, arraste cada nota para o lado para vê-la por completo.</p>
          ${U.notasPromissorias(d)}
        </section>
        ${assinado ? '' : `<section class="card mt-3" id="sign-card"><div class="card-header"><h2>Assinar contrato</h2></div><div class="card-body">
          <form id="form-assinar" novalidate><div class="form-grid">
            <div class="field"><label for="as-nome">Nome completo <span class="req">*</span></label>
              <input type="text" id="as-nome" name="nome" autocomplete="name" maxlength="150"><span class="error-msg"></span></div>
            <div class="field"><label for="as-cpf">CPF <span class="req">*</span></label>
              <input type="text" id="as-cpf" name="cpf" inputmode="numeric" maxlength="14" autocomplete="off">
              <span class="hint">Usado para confirmar sua identidade.</span><span class="error-msg"></span></div>
            <div class="field full"><label for="as-pad">Assinatura <span class="req">*</span></label>
              <canvas class="signature-pad" id="as-pad" aria-label="Área para desenhar a assinatura"></canvas>
              <div class="signature-actions"><span class="hint">Desenhe sua assinatura com o dedo ou o mouse.</span>
                <button type="button" class="btn btn-sm" id="as-limpar">Limpar</button></div>
              <span class="error-msg" id="as-pad-erro" style="display:none"></span></div>
            <div class="field full"><label class="checkbox"><input type="checkbox" name="aceite">
              <span>Li e concordo com as condições acima. Declaro que emito as ${n} notas promissórias apresentadas em favor de
              ${esc(d.organizacao.nome)} e reconheço esta assinatura eletrônica como minha.</span></label><span class="error-msg"></span></div>
          </div>
          <button type="submit" class="btn btn-primary mt-2" style="width:100%">Assinar contrato</button></form>
        </div></section>`}
      </div>`;

      root.querySelector('#btn-print').addEventListener('click', () => {
        document.body.classList.add('printing-public');
        window.print();
        setTimeout(() => document.body.classList.remove('printing-public'), 500);
      });
      if (assinado) return;

      root.querySelector('#btn-ir-assinar').addEventListener('click', () => root.querySelector('#sign-card').scrollIntoView({ behavior: 'smooth' }));
      const form = root.querySelector('#form-assinar');
      const pad = signaturePad(root.querySelector('#as-pad'));
      const padErro = root.querySelector('#as-pad-erro');
      root.querySelector('#as-limpar').addEventListener('click', () => pad.limpar());
      form.cpf.addEventListener('blur', () => { if (form.cpf.value) form.cpf.value = U.formatCPF(form.cpf.value); });

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        U.clearErrors(form);
        padErro.style.display = 'none';
        const nome = form.nome.value.trim().replace(/\s+/g, ' ');
        let ok = true;
        if (nome.length < 5 || !nome.includes(' ')) { U.fieldError(form, 'nome', 'Informe seu nome completo.'); ok = false; }
        if (!U.validCPF(form.cpf.value)) { U.fieldError(form, 'cpf', 'CPF inválido.'); ok = false; }
        if (pad.vazio()) { padErro.textContent = 'Desenhe sua assinatura.'; padErro.style.display = 'block'; ok = false; }
        if (!form.aceite.checked) { U.fieldError(form, 'aceite', 'É necessário aceitar para assinar.'); ok = false; }
        if (!ok) { U.focusFirstError(form); return; }
        const btn = form.querySelector('button[type=submit]');
        U.busy(btn, true, 'Assinando...');
        try {
          const res = await U.rpc('assinar_contrato', {
            p_token: token, p_nome: nome, p_cpf: U.digits(form.cpf.value), p_assinatura: pad.imagem(), p_aceite: true,
          });
          if (!res || !res.ok) {
            U.busy(btn, false);
            U.toast((res && res.erro) || 'Não foi possível assinar.', 'error', 9000);
            if (res && /cancelado/.test(res.erro || '')) await carregar();
            return;
          }
          U.toast('Contrato assinado com sucesso!', 'success', 8000);
          await carregar();
          window.scrollTo(0, 0);
        } catch (err) {
          U.busy(btn, false);
          U.toast(U.errorMessage(err), 'error', 9000);
        }
      });
    }

    await carregar();
  }

  // ---------------------------------------------------------------- comprovante do cliente (index.html#comprovante?t=TOKEN)
  async function telaComprovante(token) {
    ['auth-screen', 'tests-screen'].forEach((id) => { const e = document.getElementById(id); if (e) e.remove(); });
    const root = document.getElementById('public-screen');
    root.classList.remove('hidden');
    document.body.classList.remove('auth-pending');
    document.title = `Comprovante de pagamento — ${cfg.APP_NAME || 'CrediGestor'}`;
    const falha = (msg) => { root.innerHTML = `<div class="public-wrap"><div class="card">${U.errorHTML(msg, false)}</div></div>`; };
    if (Auth.problem) { falha('Sistema temporariamente indisponível. Tente novamente mais tarde.'); return; }
    if (!/^[0-9a-f]{64}$/.test(token)) { falha('Link de comprovante inválido. Confira se copiou o endereço completo.'); return; }
    root.innerHTML = `<div class="public-wrap">${U.loadingHTML('Carregando comprovante...')}</div>`;
    let d;
    try {
      d = await U.rpc('obter_comprovante', { p_token: token });
    } catch (err) {
      falha(U.errorMessage(err));
      return;
    }
    const esc = U.esc;
    const ct = d.contrato;
    const pags = (d.pagamentos || []).map((p) => Object.assign({}, p, { qtd_parcelas: ct.qtd_parcelas, contrato_numero: ct.numero }));
    const confirmados = pags.filter((p) => p.status === 'confirmado');
    const total = confirmados.reduce((a, p) => a + Number(p.valor), 0);
    root.innerHTML = `<div class="public-wrap">
      <header class="public-header"><span class="brand-mark">₢</span>
        <div><h1 class="mb-0">${esc(d.organizacao.nome)}</h1>
        <div class="muted">Comprovante de pagamento · contrato nº ${esc(ct.numero)}</div></div></header>
      ${confirmados.length
        ? `<div class="alert alert-success"><strong>Pagamento recebido.</strong> ${confirmados.length === 1
            ? `Parcela ${confirmados[0].parcela_numero}/${ct.qtd_parcelas} — ${U.money(total)} em ${U.date(confirmados[0].data_pagamento)}.`
            : `${confirmados.length} parcelas — total de ${U.money(total)}.`}</div>`
        : '<div class="alert alert-danger"><strong>Este pagamento foi estornado.</strong> Em caso de dúvida, fale com quem enviou o link.</div>'}
      <section class="np-print">
        <div class="page-header"><h2 class="mb-0">${pags.length === 1 ? 'Nota promissória da parcela' : 'Notas promissórias das parcelas'}</h2>
          <button type="button" class="btn no-print" id="btn-print">${U.icon('printer')} Imprimir / salvar PDF</button></div>
        <p class="small muted no-print">No celular, arraste a nota para o lado para vê-la por completo.</p>
        ${pags.map((p) => window.Pagamentos.comprovanteHTML(p, d, true)).join('<div class="divider"></div>')}
      </section>
    </div>`;
    root.querySelector('#btn-print').addEventListener('click', () => {
      document.body.classList.add('printing-public');
      window.print();
      setTimeout(() => document.body.classList.remove('printing-public'), 500);
    });
  }

  // ---------------------------------------------------------------- navegação (index.html#tela)
  const pages = {};
  let ctxAtual = null;
  let started = false;

  /** "#contratos?contrato=ID" → { id: 'contratos', params } */
  function parseHash() {
    const raw = location.hash.replace(/^#/, '');
    const [id, query = ''] = raw.split('?');
    return { id: pages[id] ? id : 'dashboard', params: new URLSearchParams(query) };
  }

  async function route() {
    const { id, params } = parseHash();
    const page = pages[id];
    App.params = params;
    document.querySelectorAll('dialog').forEach((d) => (d._fechar ? d._fechar() : d.remove()));
    U.charts.forEach((c) => c.destroy());
    U.charts.clear();
    document.body.dataset.page = id;
    document.title = `${page.title} — ${cfg.APP_NAME || 'CrediGestor'}`;
    document.querySelector('.topbar-title').textContent = page.title;
    document.querySelectorAll('.nav-item').forEach((a) => {
      const on = a.dataset.nav === id;
      a.classList.toggle('active', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    const content = document.getElementById('content');
    const tpl = document.getElementById('tpl-' + id);
    content.innerHTML = '';
    content.appendChild(tpl.content.cloneNode(true));
    window.scrollTo(0, 0);
    try {
      await page.onReady(ctxAtual);
    } catch (err) {
      console.error(err);
      U.toast(U.errorMessage(err), 'error');
    }
  }

  const App = {
    NAV,
    params: new URLSearchParams(),

    /** Registra uma tela: o conteúdo vem de <template id="tpl-ID"> e onReady(ctx) a preenche. */
    page(id, title, onReady) { pages[id] = { title, onReady }; },

    /** Navega para outra tela (ex.: App.go('contratos', { contrato: id })). */
    go(id, params) {
      const q = params ? '?' + new URLSearchParams(params).toString() : '';
      location.hash = '#' + id + q;
    },

    /** Inicia a área autenticada (após login ou com sessão existente). */
    async start() {
      let ctx;
      try {
        ctx = await Auth.requireAuth();
      } catch (err) {
        console.error(err);
        renderFatal(U.errorMessage(err));
        return;
      }
      if (!ctx) { Auth.showLogin(); return; }
      if (started) return;
      started = true;
      ctxAtual = ctx;
      const auth = document.getElementById('auth-screen');
      if (auth) auth.remove(); // evita IDs duplicados com as telas internas
      document.getElementById('app-shell').classList.remove('hidden');
      renderShell(ctx);
      document.body.classList.remove('auth-pending');
      window.addEventListener('hashchange', route);
      await route();
    },

    /** Ponto de entrada do index.html. */
    async boot() {
      const hash = location.hash;
      if (hash.startsWith('#assinar')) { // página pública de assinatura (sem login)
        await telaAssinatura(new URLSearchParams(hash.split('?')[1] || '').get('t') || '');
        return;
      }
      if (hash.startsWith('#comprovante')) { // página pública do comprovante (sem login)
        await telaComprovante(new URLSearchParams(hash.split('?')[1] || '').get('t') || '');
        return;
      }
      if (hash === '#testes') { // testes do motor financeiro: não exigem login
        document.getElementById('auth-screen').remove();
        document.getElementById('tests-screen').classList.remove('hidden');
        document.body.classList.remove('auth-pending');
        return;
      }
      document.getElementById('tests-screen').remove();
      if (Auth.problem) { Auth.showLogin(); return; }
      // Links de confirmação/recuperação do Supabase chegam com tokens no hash.
      if (/access_token=|error_description=|type=recovery/.test(hash)) {
        await Auth.client.auth.getSession();
        Auth.showLogin({ recovery: /type=recovery/.test(hash) });
        return;
      }
      await App.start();
    },
  };

  window.addEventListener('hashchange', () => { if (location.hash === '#testes') location.reload(); });

  window.U = U;
  window.App = App;
  window.DataTable = DataTable;
})();

/* ==========================================================================
 * finance.js
 * ========================================================================== */
/*
 * finance.js — Motor de cálculo financeiro com precisão decimal exata.
 *
 * Valores monetários são BigInt em centavos; taxas são BigInt na escala 1e8
 * (0,025 = 2.500.000n). Nenhuma conta monetária usa ponto flutuante.
 * O algoritmo é idêntico ao de public.calcular_cronograma() no banco; o
 * servidor recusa contratos cuja simulação divirja do cálculo oficial.
 *
 * Funciona no navegador (window.Finance) e no Node.js (require) para testes.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Finance = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const RATE_SCALE = 100000000n; // 1e8
  const FREQ_DIAS = { mensal: 30, quinzenal: 15, semanal: 7 };
  const SISTEMAS = ['PRICE', 'SAC'];

  /** Divisão de inteiros não negativos com arredondamento half-up. */
  function divRound(num, den) {
    if (den <= 0n) throw new Error('Divisor inválido');
    if (num < 0n) return -divRound(-num, den);
    return (2n * num + den) / (2n * den);
  }

  /** Converte "1234.567" (ou número) em BigInt na escala 10^scale, half-up. */
  function parseDecimal(value, scale) {
    if (value === null || value === undefined || value === '') throw new Error('Valor vazio');
    const s = String(value).trim();
    if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error('Número inválido: ' + s);
    const neg = s.startsWith('-');
    const [int, frac = ''] = (neg ? s.slice(1) : s).split('.');
    const padded = (frac + '0'.repeat(scale + 1)).slice(0, scale + 1);
    let n = BigInt(int + padded.slice(0, scale));
    if (Number(padded[scale]) >= 5) n += 1n;
    return neg ? -n : n;
  }

  /** Formata BigInt escalado como string decimal ("1234.56"). */
  function formatScaled(n, scale) {
    const neg = n < 0n;
    let s = (neg ? -n : n).toString().padStart(scale + 1, '0');
    const out = scale ? s.slice(0, -scale) + '.' + s.slice(-scale) : s;
    return (neg ? '-' : '') + out;
  }

  const toCents = (v) => parseDecimal(v, 2);
  const centsToString = (c) => formatScaled(c, 2);
  /** "2.5" (% a.m.) → 2500000n (0,025 na escala 1e8). Aceita até 6 casas no percentual. */
  const rateFromPercent = (pct) => parseDecimal(pct, 6);
  const rateToString = (r) => formatScaled(r, 8);

  /** Taxa equivalente do período: (1+i)^(dias/30) − 1, arredondada a 8 casas. */
  function periodRate(monthlyRate, frequencia) {
    const dias = FREQ_DIAS[frequencia];
    if (!dias) throw new Error('Frequência inválida');
    if (dias === 30) return monthlyRate;
    const x = Math.pow(1 + Number(monthlyRate) / 1e8, dias / 30) - 1;
    return BigInt(Math.round(x * 1e8));
  }

  // ---------- Datas (ISO yyyy-mm-dd, sem fuso horário) ----------
  function parseISO(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) throw new Error('Data inválida: ' + iso);
    return { y: +m[1], m: +m[2], d: +m[3] };
  }
  const pad = (n) => String(n).padStart(2, '0');
  const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

  function addMonths(iso, k) {
    const { y, m, d } = parseISO(iso);
    const total = (m - 1) + k;
    const ny = y + Math.floor(total / 12);
    const nm = ((total % 12) + 12) % 12 + 1;
    return `${ny}-${pad(nm)}-${pad(Math.min(d, daysInMonth(ny, nm)))}`;
  }

  function addDays(iso, k) {
    const { y, m, d } = parseISO(iso);
    const dt = new Date(Date.UTC(y, m - 1, d + k));
    return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
  }

  function diffDays(a, b) {
    const A = parseISO(a), B = parseISO(b);
    return Math.round((Date.UTC(B.y, B.m - 1, B.d) - Date.UTC(A.y, A.m - 1, A.d)) / 86400000);
  }

  function dueDate(first, frequencia, k) {
    if (frequencia === 'mensal') return addMonths(first, k - 1);
    return addDays(first, FREQ_DIAS[frequencia] * (k - 1));
  }

  /** Primeiro vencimento sugerido: um período após a contratação. */
  function defaultFirstDue(contractDate, frequencia) {
    return frequencia === 'mensal' ? addMonths(contractDate, 1) : addDays(contractDate, FREQ_DIAS[frequencia]);
  }

  /**
   * Gera o cronograma.
   * @param {object} p
   *   principal (string "1000.00"), taxaMensalPct (string "2.5"), parcelas (int),
   *   frequencia ('mensal'|'quinzenal'|'semanal'), sistema ('PRICE'|'SAC'),
   *   encargos (string, opcional), primeiroVencimento (ISO), dataContratacao (ISO, p/ CET)
   */
  function schedule(p) {
    const P = toCents(p.principal);
    const E = p.encargos ? toCents(p.encargos) : 0n;
    const n = Number(p.parcelas);
    const i = rateFromPercent(p.taxaMensalPct);
    if (P < 100n) throw new Error('Principal deve ser de no mínimo R$ 1,00.');
    if (!Number.isInteger(n) || n < 1 || n > 360) throw new Error('Quantidade de parcelas deve estar entre 1 e 360.');
    if (!FREQ_DIAS[p.frequencia]) throw new Error('Frequência inválida.');
    if (!SISTEMAS.includes(p.sistema)) throw new Error('Sistema de amortização inválido.');
    if (i < 0n || i >= RATE_SCALE) throw new Error('Taxa de juros inválida.');
    if (E < 0n) throw new Error('Encargos não podem ser negativos.');
    parseISO(p.primeiroVencimento);

    const r = periodRate(i, p.frequencia);
    const N = BigInt(n);
    let pmt = 0n;
    if (p.sistema === 'PRICE') {
      if (r === 0n) {
        pmt = divRound(P, N);
      } else {
        // PMT = P·r·(1+r)^n / ((1+r)^n − 1), com potências inteiras exatas.
        const F = (RATE_SCALE + r) ** N;
        const Dn = RATE_SCALE ** N;
        pmt = divRound(P * r * F, RATE_SCALE * (F - Dn));
      }
    }

    const rows = [];
    let saldo = P;
    for (let k = 1; k <= n; k++) {
      const K = BigInt(k);
      const juros = divRound(saldo * r, RATE_SCALE);
      let amort;
      if (k === n) amort = saldo;
      else if (p.sistema === 'PRICE') {
        amort = pmt - juros;
        if (amort < 0n) amort = 0n;
        if (amort > saldo) amort = saldo;
      } else {
        amort = divRound(P * K, N) - divRound(P * (K - 1n), N);
      }
      const enc = divRound(E * K, N) - divRound(E * (K - 1n), N);
      rows.push({
        numero: k,
        vencimento: dueDate(p.primeiroVencimento, p.frequencia, k),
        saldoInicial: saldo,
        principal: amort,
        juros,
        encargos: enc,
        total: amort + juros + enc,
      });
      saldo -= amort;
    }

    const sum = (key) => rows.reduce((a, x) => a + x[key], 0n);
    const result = {
      taxaPeriodo: r,
      rows,
      totalPrincipal: sum('principal'),
      totalJuros: sum('juros'),
      totalEncargos: sum('encargos'),
      total: sum('total'),
      valorParcela: rows[0].total,
      cetMensal: null,
    };
    if (p.dataContratacao) result.cetMensal = cetMensal(P, p.dataContratacao, rows);
    return result;
  }

  /** CET mensal (TIR, base 30 dias) por bisseção — informativo. */
  function cetMensal(principalCents, dataContratacao, rows) {
    const P = Number(principalCents);
    const flows = rows.map((x) => ({ t: diffDays(dataContratacao, x.vencimento) / 30, v: Number(x.total) }));
    const npv = (rate) => flows.reduce((a, f) => a + f.v / Math.pow(1 + rate, f.t), -P);
    let lo = 0, hi = 1;
    if (npv(hi) > 0) return null;
    for (let it = 0; it < 80; it++) {
      const mid = (lo + hi) / 2;
      if (npv(mid) > 0) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  const annualFromMonthly = (m) => (m === null ? null : Math.pow(1 + m, 12) - 1);

  // ---------- Valores e datas por extenso (notas promissórias) ----------
  const UNIDADES = ['zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez',
    'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
  const DEZENAS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
  const CENTENAS = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];
  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

  /** 0–999 por extenso. */
  function ateMil(n) {
    if (n < 20) return UNIDADES[n];
    if (n < 100) return DEZENAS[Math.floor(n / 10)] + (n % 10 ? ' e ' + UNIDADES[n % 10] : '');
    if (n === 100) return 'cem';
    return CENTENAS[Math.floor(n / 100)] + (n % 100 ? ' e ' + ateMil(n % 100) : '');
  }

  /** Inteiro não negativo (até trilhões) por extenso: 1234 → "mil duzentos e trinta e quatro". */
  function numeroPorExtenso(valor) {
    let n = BigInt(valor);
    if (n < 0n) throw new Error('Número negativo');
    if (n === 0n) return 'zero';
    const escalas = [['', ''], ['mil', 'mil'], ['milhão', 'milhões'], ['bilhão', 'bilhões'], ['trilhão', 'trilhões']];
    const grupos = [];
    for (let i = 0; n > 0n; i++, n /= 1000n) grupos.push({ v: Number(n % 1000n), i });
    if (grupos.length > escalas.length) throw new Error('Número muito grande');
    const partes = grupos.filter((g) => g.v).reverse().map((g) => {
      if (g.i === 0) return { t: ateMil(g.v), v: g.v, i: 0 };
      if (g.i === 1) return { t: g.v === 1 ? 'mil' : `${ateMil(g.v)} mil`, v: g.v, i: 1 };
      return { t: `${ateMil(g.v)} ${g.v === 1 ? escalas[g.i][0] : escalas[g.i][1]}`, v: g.v, i: g.i };
    });
    // Último grupo < 100 ou centena redonda liga com "e" ("mil e cem"); unidades após o milhar, com espaço
    // ("mil duzentos e trinta"); demais grupos, com vírgula ("um milhão, duzentos mil").
    return partes.reduce((acc, p, idx) => {
      if (idx === 0) return p.t;
      const usaE = idx === partes.length - 1 && (p.v < 100 || p.v % 100 === 0);
      return acc + (usaE ? ' e ' : p.i === 0 ? ' ' : ', ') + p.t;
    }, '');
  }

  /** Valor em reais por extenso: "1234.56" → "mil duzentos e trinta e quatro reais e cinquenta e seis centavos". */
  function valorPorExtenso(valor) {
    const c = typeof valor === 'bigint' ? valor : toCents(valor);
    if (c < 0n) throw new Error('Valor negativo');
    const reais = c / 100n;
    const cent = Number(c % 100n);
    const partes = [];
    if (reais > 0n) {
      const ext = numeroPorExtenso(reais);
      const deReais = reais >= 1000000n && reais % 1000000n === 0n; // "um milhão de reais"
      partes.push(`${ext} ${deReais ? 'de ' : ''}${reais === 1n ? 'real' : 'reais'}`);
    }
    if (cent > 0) partes.push(`${ateMil(cent)} ${cent === 1 ? 'centavo' : 'centavos'}`);
    return partes.length ? partes.join(' e ') : 'zero real';
  }

  /** "2026-11-25" → { dia: 25, mes: 'novembro', ano: 2026, diaExtenso: 'vinte e cinco', anoExtenso: 'dois mil e vinte e seis' } */
  function dataPorExtenso(iso) {
    const { y, m, d } = parseISO(iso);
    return { dia: d, mes: MESES[m - 1], ano: y, diaExtenso: numeroPorExtenso(d), anoExtenso: numeroPorExtenso(y) };
  }

  /**
   * Imputação de pagamento (mesma regra do banco): juros → encargos → principal.
   * parcela: { juros, encargos, principal, pagoJuros, pagoEncargos, pagoPrincipal } em centavos.
   */
  function allocatePayment(parcela, valor) {
    const restante = (parcela.juros - parcela.pagoJuros) + (parcela.encargos - parcela.pagoEncargos) +
                     (parcela.principal - parcela.pagoPrincipal);
    if (valor <= 0n) throw new Error('O valor do pagamento deve ser maior que zero.');
    if (valor > restante) throw new Error('Valor excede o saldo da parcela.');
    let rest = valor;
    const juros = rest < parcela.juros - parcela.pagoJuros ? rest : parcela.juros - parcela.pagoJuros;
    rest -= juros;
    const encargos = rest < parcela.encargos - parcela.pagoEncargos ? rest : parcela.encargos - parcela.pagoEncargos;
    rest -= encargos;
    return { juros, encargos, principal: rest };
  }

  return {
    RATE_SCALE, FREQ_DIAS, SISTEMAS,
    divRound, parseDecimal, formatScaled, toCents, centsToString, rateFromPercent, rateToString,
    periodRate, addMonths, addDays, diffDays, dueDate, defaultFirstDue,
    schedule, cetMensal, annualFromMonthly, allocatePayment,
    numeroPorExtenso, valorPorExtenso, dataPorExtenso,
  };
});

/* ==========================================================================
 * pagamentos.js
 * ========================================================================== */
/*
 * pagamentos.js — Registro de recebimentos (totais/parciais), detecção de
 * duplicidade, recibos e estornos com justificativa. Pagamentos nunca são
 * apagados. Também expõe window.Pagamentos para as telas de contratos e parcelas.
 */
(function () {
  'use strict';
  const { esc, money, date } = U;
  const F = window.Finance;

  function allocationPreview(p, valorStr) {
    if (!F || !valorStr) return '';
    try {
      const a = F.allocatePayment({
        juros: F.toCents(p.valor_juros), encargos: F.toCents(p.valor_encargos), principal: F.toCents(p.valor_principal),
        pagoJuros: F.toCents(p.pago_juros), pagoEncargos: F.toCents(p.pago_encargos), pagoPrincipal: F.toCents(p.pago_principal),
      }, F.toCents(valorStr));
      return `Imputação: juros ${money(a.juros)} · encargos ${money(a.encargos)} · principal ${money(a.principal)}`;
    } catch (err) {
      return `<span class="text-danger">${esc(err.message)}</span>`;
    }
  }

  /** Modal de recebimento para uma parcela (linha de vw_parcelas). */
  function openPaymentModal({ parcela: p, onDone }) {
    const saldo = String(p.saldo);
    const m = U.modal({
      title: 'Registrar pagamento',
      size: 'lg',
      body: `
        <div class="summary-grid">
          <div class="summary-item"><div class="label">Cliente</div><div class="value" style="font-size:.95rem">${esc(p.cliente_nome)}</div></div>
          <div class="summary-item"><div class="label">Contrato / parcela</div><div class="value">${esc(p.contrato_numero)} · ${p.numero}/${p.qtd_parcelas}</div></div>
          <div class="summary-item"><div class="label">Vencimento</div><div class="value">${date(p.vencimento)}</div></div>
          <div class="summary-item"><div class="label">Valor da parcela</div><div class="value">${money(p.valor_total)}</div></div>
          <div class="summary-item"><div class="label">Já pago</div><div class="value">${money(p.valor_pago)}</div></div>
          <div class="summary-item"><div class="label">Saldo</div><div class="value">${money(saldo)}</div></div>
        </div>
        <form id="form-pagamento" novalidate>
          <div class="form-grid">
            <div class="field"><label for="pg-valor">Valor recebido (R$) <span class="req">*</span></label>
              <input type="text" id="pg-valor" name="valor" inputmode="decimal" value="${esc(U.moneyInput(saldo))}">
              <span class="hint" id="pg-aloc"></span><span class="error-msg"></span></div>
            <div class="field"><label for="pg-data">Data efetiva do pagamento <span class="req">*</span></label>
              <input type="date" id="pg-data" name="data" max="${U.today()}" value="${U.today()}">
              <span class="hint" id="pg-atraso"></span><span class="error-msg"></span></div>
            <div class="field"><label for="pg-forma">Forma de pagamento <span class="req">*</span></label>
              <select id="pg-forma" name="forma">${U.options(U.LABELS.forma, 'pix')}</select></div>
            <div class="field full"><label for="pg-obs">Observações</label>
              <textarea id="pg-obs" name="observacoes" maxlength="1000" placeholder="Ex.: identificador da transação PIX"></textarea></div>
          </div>
        </form>
        <p class="small muted">Pagamentos parciais são permitidos. O valor é imputado primeiro aos juros, depois aos encargos e por fim ao principal.
          Multa e juros de mora não são calculados automaticamente.</p>`,
      footer: `<button type="button" class="btn" data-close>Cancelar</button><button type="submit" form="form-pagamento" class="btn btn-success">Confirmar recebimento</button>`,
    });
    const form = m.el.querySelector('form');
    const aloc = m.el.querySelector('#pg-aloc');
    const atraso = m.el.querySelector('#pg-atraso');
    const update = () => {
      aloc.innerHTML = allocationPreview(p, U.parseMoney(form.valor.value));
      const d = form.data.value && F ? F.diffDays(p.vencimento, form.data.value) : 0;
      atraso.innerHTML = d > 0 ? `<span class="text-warning">Pagamento ${d} dia(s) após o vencimento.</span>` : '';
    };
    form.valor.addEventListener('input', update);
    form.data.addEventListener('change', update);
    form.valor.addEventListener('blur', () => { const v = U.parseMoney(form.valor.value); if (v) form.valor.value = U.moneyInput(v); });
    update();
    form.valor.select();

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      U.clearErrors(form);
      const valor = U.parseMoney(form.valor.value);
      let ok = true;
      if (!valor || F.toCents(valor) <= 0n) { U.fieldError(form, 'valor', 'Informe um valor maior que zero.'); ok = false; }
      else if (F.toCents(valor) > F.toCents(saldo)) { U.fieldError(form, 'valor', `Valor acima do saldo (${money(saldo)}).`); ok = false; }
      if (!form.data.value) { U.fieldError(form, 'data', 'Informe a data.'); ok = false; }
      else if (form.data.value > U.today()) { U.fieldError(form, 'data', 'A data não pode ser futura.'); ok = false; }
      if (!ok) { U.focusFirstError(form); return; }

      const btn = m.el.querySelector('button[type=submit]');
      const params = {
        p_parcela_id: p.id, p_valor: valor, p_data_pagamento: form.data.value, p_forma: form.forma.value,
        p_observacoes: form.observacoes.value.trim() || null, p_confirmar_duplicidade: false,
      };
      U.busy(btn, true, 'Registrando...');
      try {
        let res;
        try {
          res = await U.rpc('registrar_pagamento', params);
        } catch (err) {
          if (err.code !== 'CG001') throw err;
          U.busy(btn, false);
          const confirm = await U.confirm({
            title: 'Possível pagamento duplicado',
            html: true,
            message: `<div class="alert alert-warning">${esc(U.errorMessage(err))}</div><p>Confira os pagamentos do contrato antes de prosseguir. Deseja registrar mesmo assim?</p>`,
            confirmText: 'Registrar mesmo assim',
            danger: true,
          });
          if (!confirm) return;
          U.busy(btn, true, 'Registrando...');
          res = await U.rpc('registrar_pagamento', Object.assign({}, params, { p_confirmar_duplicidade: true }));
        }
        m.close();
        U.toast(`Pagamento registrado. Recibo nº ${res.numero_recibo}.`, 'success');
        if (onDone) onDone(res);
        openReceipt(res.id, { aposPagamento: true });
      } catch (err) {
        U.busy(btn, false);
        U.toast(U.errorMessage(err), 'error', 9000);
      }
    });
  }

  /** Seleção de contrato e parcela para um novo recebimento. */
  function openNewPayment(onDone) {
    const m = U.modal({
      title: 'Novo pagamento',
      size: 'lg',
      body: `<form id="form-sel" novalidate><div class="form-grid">
          <div class="field full"><label for="sel-busca">Contrato</label>
            <input type="search" id="sel-busca" placeholder="Digite o nº do contrato ou o nome do cliente" autocomplete="off">
            <select id="sel-contrato" name="contrato" class="mt-1"><option value="">Digite para buscar contratos ativos</option></select>
            <span class="error-msg"></span></div>
          <div class="field full"><label for="sel-parcela">Parcela</label>
            <select id="sel-parcela" name="parcela" disabled><option value="">Selecione o contrato</option></select>
            <span class="error-msg"></span></div>
        </div></form>`,
      footer: `<button type="button" class="btn" data-close>Cancelar</button>
        <button type="button" class="btn btn-success" data-quitar disabled>Quitar contrato inteiro</button>
        <button type="submit" form="form-sel" class="btn btn-primary">Receber parcela</button>`,
    });
    const form = m.el.querySelector('form');
    let contratos = [];
    const btnQuitar = m.el.querySelector('[data-quitar]');
    btnQuitar.addEventListener('click', () => {
      const c = contratos.find((x) => x.id === form.contrato.value);
      if (!c) return;
      m.close();
      openQuitacao(c, onDone);
    });
    const selC = form.contrato;
    const selP = form.parcela;
    let parcelas = [];

    const search = U.debounce(async (q) => {
      q = U.sanitizeSearch(q);
      if (!q) return;
      selC.innerHTML = '<option value="">Buscando...</option>';
      try {
        let query = Auth.client.from('vw_contratos').select('id, numero, cliente_nome, saldo_aberto').eq('status', 'ativo')
          .order('numero', { ascending: false }).limit(30);
        query = /^\d+$/.test(q) ? query.eq('numero', Number(q)) : query.ilike('cliente_nome', `%${q}%`);
        const { data, error } = await query;
        if (error) throw error;
        contratos = data;
        btnQuitar.disabled = true;
        selC.innerHTML = `<option value="">${data.length ? 'Selecione o contrato' : 'Nenhum contrato ativo encontrado'}</option>` +
          data.map((c) => `<option value="${esc(c.id)}">Nº ${esc(c.numero)} — ${esc(c.cliente_nome)} — saldo ${money(c.saldo_aberto)}</option>`).join('');
      } catch (err) {
        selC.innerHTML = '<option value="">Erro ao buscar</option>';
        U.toast(U.errorMessage(err), 'error');
      }
    });
    m.el.querySelector('#sel-busca').addEventListener('input', (e) => search(e.target.value));

    selC.addEventListener('change', async () => {
      btnQuitar.disabled = !selC.value;
      selP.disabled = true;
      selP.innerHTML = '<option value="">Carregando...</option>';
      if (!selC.value) { selP.innerHTML = '<option value="">Selecione o contrato</option>'; return; }
      try {
        const { data, error } = await Auth.client.from('vw_parcelas').select('*').eq('contrato_id', selC.value)
          .in('status', ['aberta', 'parcial']).order('numero');
        if (error) throw error;
        parcelas = data;
        selP.innerHTML = data.length
          ? data.map((p) => `<option value="${esc(p.id)}">${p.numero}/${p.qtd_parcelas} — vence ${date(p.vencimento)} — saldo ${money(p.saldo)}${p.situacao === 'vencida' ? ' (VENCIDA)' : ''}</option>`).join('')
          : '<option value="">Nenhuma parcela em aberto</option>';
        selP.disabled = !data.length;
      } catch (err) {
        selP.innerHTML = '<option value="">Erro ao carregar</option>';
        U.toast(U.errorMessage(err), 'error');
      }
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      U.clearErrors(form);
      if (!selC.value) { U.fieldError(form, 'contrato', 'Selecione o contrato.'); return; }
      const p = parcelas.find((x) => x.id === selP.value);
      if (!p) { U.fieldError(form, 'parcela', 'Selecione a parcela.'); return; }
      m.close();
      openPaymentModal({ parcela: p, onDone });
    });
  }

  /** Detalhes do pagamento exibidos abaixo da nota promissória (versão pública omite dados internos). */
  function detalhesPagamento(g, parcela, publico) {
    const dispensa = parcela && Number(parcela.juros_dispensados) > 0;
    return `<dl class="dl small mt-1">
      <dt>Recibo</dt><dd>nº ${esc(g.numero_recibo)} · parcela ${g.parcela_numero}/${g.qtd_parcelas} do contrato nº ${esc(g.contrato_numero)}</dd>
      <dt>Valor pago</dt><dd><strong>${money(g.valor)}</strong> em ${date(g.data_pagamento)} · ${esc(U.LABELS.forma[g.forma])}</dd>
      <dt>Composição</dt><dd>Principal ${money(g.valor_principal)} · Juros ${money(g.valor_juros)} · Encargos ${money(g.valor_encargos)}</dd>
      ${dispensa ? `<dt>Juros dispensados</dt><dd>${money(parcela.juros_dispensados)} (quitação sem juros)</dd>` : ''}
      ${publico ? '' : `<dt>Registrado por</dt><dd>${esc(g.registrado_por_nome || '—')} em ${esc(U.datetime(g.created_at))}</dd>`}
      ${!publico && g.observacoes ? `<dt>Observações</dt><dd>${esc(g.observacoes)}</dd>` : ''}
      ${g.status === 'estornado' ? `<dt>Estorno</dt><dd class="text-danger">Pagamento estornado em ${esc(U.datetime(g.estornado_em))}${
        publico ? '' : ` por ${esc(g.estornado_por_nome || '—')}: ${esc(g.estorno_motivo)}`}</dd>` : ''}
    </dl>`;
  }

  /** Comprovante: a nota promissória da parcela com carimbo de pagamento. */
  function comprovanteHTML(g, notas, publico) {
    const parcela = notas && (notas.parcelas || []).find((p) => p.numero === g.parcela_numero);
    if (!parcela) return reciboSimples(g);
    const devido = Number(parcela.valor) - Number(parcela.juros_dispensados || 0);
    const [rotulo, tipo] = g.status === 'estornado' ? ['ESTORNADO', 'estornado']
      : Number(g.valor) >= devido - 0.005 ? ['PAGO', 'pago'] : ['PAGO PARCIAL', 'parcial'];
    return `<div class="comprovante">
      <div class="np-pago-wrap">${U.notaPromissoria(notas, parcela)}
        <div class="np-carimbo np-carimbo-${tipo}" aria-hidden="true"><strong>${rotulo}</strong>
          <span>${money(g.valor)} em ${date(g.data_pagamento)}</span><span>Recibo nº ${esc(g.numero_recibo)}</span></div>
      </div>
      ${detalhesPagamento(g, parcela, publico)}
    </div>`;
  }

  /**
   * Comprovante(s) de pagamento. Aceita um id ou uma lista (ex.: quitação).
   * Mostra a nota promissória correspondente carimbada; sem acesso às notas, mostra o recibo simples.
   */
  async function openReceipt(ids, opts = {}) {
    ids = [].concat(ids);
    const m = U.modal({ title: 'Comprovante', size: 'xl', body: U.loadingHTML(),
      footer: `<button type="button" class="btn" data-close>Fechar</button>
        <button type="button" class="btn" data-print disabled>${U.icon('printer')} Imprimir / PDF</button>
        <button type="button" class="btn btn-whatsapp hidden" data-enviar-comprovante>Enviar comprovante pelo WhatsApp</button>` });
    try {
      const { data: lista, error } = await Auth.client.from('vw_pagamentos').select('*').in('id', ids).order('parcela_numero');
      if (error) throw error;
      if (!lista.length) throw new Error('Pagamento não encontrado.');
      let notas = null;
      if (Auth.can('pagamentos.write')) {
        try { notas = await U.rpc('notas_promissorias', { p_contrato_id: lista[0].contrato_id }); } catch (_) { notas = null; }
      }
      m.el.querySelector('h2').textContent = lista.length === 1
        ? `Comprovante — recibo nº ${lista[0].numero_recibo}`
        : `Comprovantes — contrato nº ${lista[0].contrato_numero} (${lista.length} recibos)`;
      const confirmados = lista.filter((g) => g.status === 'confirmado');
      const podeEnviar = Auth.can('pagamentos.write') && confirmados.length > 0;
      m.body.innerHTML = (opts.aposPagamento && podeEnviar
        ? '<div class="alert alert-info">Pagamento registrado. Envie o comprovante ao cliente pelo botão <strong>"Enviar comprovante pelo WhatsApp"</strong>.</div>' : '')
        + (lista.length > 1
        ? `<div class="alert alert-success">Total pago: <strong>${money(confirmados.reduce((a, g) => a + Number(g.valor), 0))}</strong>
            em ${confirmados.length} parcela(s)${confirmados.length < lista.length ? ` (${lista.length - confirmados.length} estornado(s) não somado(s))` : ''}.</div>` : '')
        + lista.map((g) => comprovanteHTML(g, notas)).join('<div class="divider"></div>');
      const btn = m.el.querySelector('[data-print]');
      btn.disabled = false;
      btn.addEventListener('click', () => U.printModal());
      const btnEnviar = m.el.querySelector('[data-enviar-comprovante]');
      if (podeEnviar) {
        btnEnviar.classList.remove('hidden');
        btnEnviar.addEventListener('click', () => enviarComprovante(confirmados, btnEnviar));
      }
    } catch (err) {
      m.body.innerHTML = U.errorHTML(U.errorMessage(err), false);
    }
  }

  /** Gera o link público do comprovante e abre o envio pelo WhatsApp. lista = linhas confirmadas de vw_pagamentos. */
  async function enviarComprovante(lista, btn) {
    U.busy(btn, true, 'Gerando link...');
    try {
      const [link, cli] = await Promise.all([
        U.rpc('gerar_link_comprovante', { p_pagamentos: lista.map((g) => g.id) }),
        Auth.client.from('clientes').select('nome, telefone').eq('id', lista[0].cliente_id).single(),
      ]);
      if (cli.error) throw cli.error;
      const url = `${location.origin}${location.pathname}#comprovante?t=${link.token}`;
      U.modalWhatsApp({
        titulo: lista.length === 1 ? `Enviar comprovante — recibo nº ${lista[0].numero_recibo}` : `Enviar comprovantes — ${lista.length} parcelas`,
        intro: `O cliente abre o link sem precisar de login e vê a nota promissória ${lista.length === 1 ? 'da parcela' : 'de cada parcela'} com o carimbo de pago, podendo salvar em PDF.`,
        link: url,
        mensagem: U.mensagemComprovante({ cliente: cli.data, pagamentos: lista, link: url }),
        telefone: cli.data.telefone,
      });
    } catch (err) {
      U.toast(U.errorMessage(err), 'error', 9000);
    }
    U.busy(btn, false);
  }

  /** Quitação de todas as parcelas em aberto, com juros ou sem juros. c = linha de vw_contratos. */
  async function openQuitacao(c, onDone) {
    const m = U.modal({ title: `Quitar contrato nº ${c.numero}`, size: 'lg', body: U.loadingHTML() });
    let parcelas;
    try {
      const { data, error } = await Auth.client.from('vw_parcelas').select('*').eq('contrato_id', c.id)
        .in('status', ['aberta', 'parcial']).order('numero');
      if (error) throw error;
      parcelas = data;
    } catch (err) {
      m.body.innerHTML = U.errorHTML(U.errorMessage(err), false);
      return;
    }
    if (!parcelas.length) { m.body.innerHTML = U.emptyHTML('Nenhuma parcela em aberto', 'Este contrato não tem saldo a quitar.'); return; }
    const soma = (fn) => parcelas.reduce((a, p) => a + fn(p), 0n);
    const saldo = soma((p) => F.toCents(p.saldo));
    const juros = soma((p) => F.toCents(p.valor_juros) - F.toCents(p.pago_juros));
    const semJuros = saldo - juros;
    const podeSemJuros = Auth.can('contratos.write');
    m.body.innerHTML = `
      <p><strong>${esc(c.cliente_nome)}</strong> · ${parcelas.length} parcela(s) em aberto.
        Cada parcela recebe o seu próprio recibo e a nota promissória correspondente é carimbada como paga.</p>
      <form id="form-quitar" novalidate>
        <div class="quit-opcoes">
          <label class="quit-opcao"><input type="radio" name="modo" value="com_juros" checked>
            <div><strong>Com juros</strong><div class="quit-valor">${money(saldo)}</div>
            <span class="small muted">Paga o saldo total das parcelas em aberto.</span></div></label>
          <label class="quit-opcao ${podeSemJuros ? '' : 'quit-desabilitada'}"><input type="radio" name="modo" value="sem_juros" ${podeSemJuros ? '' : 'disabled'}>
            <div><strong>Sem juros</strong><div class="quit-valor">${money(semJuros)}</div>
            <span class="small muted">Dispensa ${money(juros)} de juros ainda não pagos.${podeSemJuros ? '' : ' Somente administrador ou gestor.'}</span></div></label>
        </div>
        <div class="form-grid mt-2">
          <div class="field"><label for="q-data">Data do pagamento <span class="req">*</span></label>
            <input type="date" id="q-data" name="data" max="${U.today()}" value="${U.today()}"><span class="error-msg"></span></div>
          <div class="field"><label for="q-forma">Forma de pagamento <span class="req">*</span></label>
            <select id="q-forma" name="forma">${U.options(U.LABELS.forma, 'pix')}</select></div>
          <div class="field full"><label for="q-obs">Observações</label>
            <input type="text" id="q-obs" name="observacoes" maxlength="300" placeholder="Ex.: acordo de quitação antecipada"></div>
        </div>
      </form>
      <div class="section-title">Parcelas que serão quitadas</div>
      <div class="table-wrap"><table class="table table-compact responsive"><thead><tr>
        <th>Nº</th><th>Vencimento</th><th class="num">Saldo</th><th class="num">Juros em aberto</th></tr></thead><tbody>
        ${parcelas.map((p) => `<tr><td data-label="Nº">${p.numero}/${p.qtd_parcelas}</td><td data-label="Vencimento">${date(p.vencimento)}</td>
          <td data-label="Saldo" class="num">${money(p.saldo)}</td>
          <td data-label="Juros em aberto" class="num">${money(F.toCents(p.valor_juros) - F.toCents(p.pago_juros))}</td></tr>`).join('')}
      </tbody></table></div>`;
    const footer = document.createElement('div');
    footer.className = 'modal-footer';
    footer.innerHTML = `<button type="button" class="btn" data-close>Cancelar</button>
      <button type="submit" form="form-quitar" class="btn btn-success">Confirmar quitação</button>`;
    m.el.querySelector('.modal-inner').appendChild(footer);
    const form = m.el.querySelector('form');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      U.clearErrors(form);
      if (!form.data.value || form.data.value > U.today()) { U.fieldError(form, 'data', 'Informe uma data até hoje.'); return; }
      const modo = form.modo.value;
      const valor = modo === 'sem_juros' ? semJuros : saldo;
      const ok = await U.confirm({
        title: 'Confirmar quitação',
        html: true,
        message: `<p>Registrar o recebimento de <strong>${money(valor)}</strong> (${modo === 'sem_juros' ? 'sem juros' : 'com juros'})
          em ${parcelas.length} parcela(s) do contrato nº ${esc(c.numero)}, em ${date(form.data.value)}?</p>
          ${modo === 'sem_juros' ? `<p class="small muted">Serão dispensados ${money(juros)} de juros. Se algum pagamento for estornado, os juros daquela parcela voltam a ser cobrados.</p>` : ''}`,
        confirmText: 'Quitar',
      });
      if (!ok) return;
      const btn = footer.querySelector('button[type=submit]');
      U.busy(btn, true, 'Registrando...');
      try {
        const res = await U.rpc('quitar_contrato', {
          p_contrato_id: c.id, p_modo: modo, p_data_pagamento: form.data.value, p_forma: form.forma.value,
          p_observacoes: form.observacoes.value.trim() || null,
        });
        m.close();
        U.toast(`Contrato quitado: ${money(res.total_pago)} recebidos${Number(res.juros_dispensados) ? `, ${money(res.juros_dispensados)} de juros dispensados` : ''}.`, 'success', 8000);
        if (onDone) onDone(res);
        if ((res.pagamentos || []).length) openReceipt(res.pagamentos, { aposPagamento: true });
      } catch (err) {
        U.busy(btn, false);
        U.toast(U.errorMessage(err), 'error', 9000);
      }
    });
  }

  /** Recibo simples (usado quando as notas promissórias não estão disponíveis). */
  function reciboSimples(g) {
    const org = Auth.org;
    return `<div class="receipt ${g.status === 'estornado' ? 'estornado' : ''}">
        <div class="receipt-head">
          <div><strong>${esc(org.nome)}</strong>${org.cnpj ? `<div class="small muted">CNPJ ${esc(U.formatCNPJ(org.cnpj))}</div>` : ''}</div>
          <div class="right"><strong>RECIBO Nº ${esc(g.numero_recibo)}</strong><div class="small muted">Emitido em ${esc(U.datetime(new Date()))}</div></div>
        </div>
        <p>Recebemos de <strong>${esc(g.cliente_nome)}</strong>${g.cpf_mascarado ? ` (CPF ${esc(g.cpf_mascarado)})` : ''} a importância de</p>
        <div class="receipt-value">${money(g.valor)}</div>
        <dl class="dl">
          <dt>Referente a</dt><dd>Parcela ${g.parcela_numero}/${g.qtd_parcelas} do contrato nº ${esc(g.contrato_numero)} (vencimento ${date(g.parcela_vencimento)})</dd>
          <dt>Composição</dt><dd>Principal ${money(g.valor_principal)} · Juros ${money(g.valor_juros)} · Encargos ${money(g.valor_encargos)}</dd>
          <dt>Data do pagamento</dt><dd>${date(g.data_pagamento)}</dd>
          <dt>Forma</dt><dd>${esc(U.LABELS.forma[g.forma])}</dd>
          <dt>Registrado por</dt><dd>${esc(g.registrado_por_nome || '—')} em ${esc(U.datetime(g.created_at))}</dd>
          ${g.observacoes ? `<dt>Observações</dt><dd>${esc(g.observacoes)}</dd>` : ''}
          ${g.status === 'estornado' ? `<dt>Estorno</dt><dd class="text-danger">${esc(U.datetime(g.estornado_em))} por ${esc(g.estornado_por_nome || '—')}: ${esc(g.estorno_motivo)}</dd>` : ''}
        </dl>
        <div class="receipt-sign">${esc(org.nome)}</div>
      </div>`;
  }

  async function reverse(row, onDone) {
    const ok = await U.confirm({
      title: `Estornar recibo nº ${row.numero_recibo}`,
      html: true,
      message: `<div class="alert alert-warning">O pagamento de <strong>${money(row.valor)}</strong> (${esc(row.cliente_nome)}) será marcado como estornado,
        o saldo da parcela será restabelecido e uma saída de estorno será lançada no caixa. O registro original é preservado.</div>`,
      confirmText: 'Estornar',
      danger: true,
      reason: { label: 'Justificativa do estorno', minLength: 10, placeholder: 'Ex.: PIX devolvido pelo banco em 12/03' },
    });
    if (!ok) return;
    try {
      await U.rpc('estornar_pagamento', { p_pagamento_id: row.id, p_motivo: ok.reason });
      U.toast('Estorno registrado.', 'success');
      if (onDone) onDone();
    } catch (err) { U.toast(U.errorMessage(err), 'error', 9000); }
  }

  window.Pagamentos = { openPaymentModal, openNewPayment, openReceipt, openQuitacao, reverse, comprovanteHTML };

  // ------------------------------------------------------------------ página
  {
    App.page('pagamentos', 'Pagamentos', async () => {
      const btnNovo = document.getElementById('btn-novo');
      btnNovo.innerHTML = `${U.icon('plus')} Novo pagamento`;
      if (!Auth.can('pagamentos.write')) btnNovo.classList.add('hidden');

      const table = new DataTable({
        container: document.getElementById('tbl-pagamentos'),
        searchPlaceholder: 'Buscar por cliente ou nº do recibo',
        filters: [
          { key: 'status', label: 'Status', type: 'select', value: 'confirmado', options: [
            { value: 'confirmado', label: 'Confirmados' }, { value: 'estornado', label: 'Estornados' }, { value: '', label: 'Todos' }] },
          { key: 'de', label: 'Pago a partir de', type: 'date', value: '' },
          { key: 'ate', label: 'Pago até', type: 'date', value: '' },
        ],
        emptyTitle: 'Nenhum pagamento encontrado',
        columns: [
          { label: 'Recibo', render: (r) => `<span class="mono">${esc(r.numero_recibo)}</span>` },
          { label: 'Data', render: (r) => date(r.data_pagamento) },
          { label: 'Cliente', render: (r) => esc(r.cliente_nome) },
          { label: 'Contrato / parcela', render: (r) => `${esc(r.contrato_numero)} · ${r.parcela_numero}/${r.qtd_parcelas}` },
          { label: 'Valor', className: 'num', render: (r) => `<strong>${money(r.valor)}</strong>` },
          { label: 'Composição', render: (r) => `<span class="small muted">P ${money(r.valor_principal)} · J ${money(r.valor_juros)}${Number(r.valor_encargos) ? ' · E ' + money(r.valor_encargos) : ''}</span>` },
          { label: 'Forma', render: (r) => esc(U.LABELS.forma[r.forma]) },
          { label: 'Status', render: (r) => U.statusBadge('pagamentoStatus', r.status) },
          { label: 'Ações', className: 'actions', render: (r) => `<div class="btn-group">
              <button class="btn btn-sm" data-action="receipt">Recibo</button>
              ${Auth.can('pagamentos.estornar') && r.status === 'confirmado' ? '<button class="btn btn-sm btn-danger" data-action="reverse">Estornar</button>' : ''}</div>` },
        ],
        fetch: async ({ from, to, search, filters }) => {
          let q = Auth.client.from('vw_pagamentos').select('*', { count: 'exact' })
            .order('data_pagamento', { ascending: false }).order('numero_recibo', { ascending: false }).range(from, to);
          if (filters.status) q = q.eq('status', filters.status);
          if (filters.de) q = q.gte('data_pagamento', filters.de);
          if (filters.ate) q = q.lte('data_pagamento', filters.ate);
          if (search) q = /^\d+$/.test(search) ? q.eq('numero_recibo', Number(search)) : q.ilike('cliente_nome', `%${search}%`);
          const { data, error, count } = await q;
          if (error) throw error;
          return { rows: data, total: count };
        },
        rowClass: (r) => (r.status === 'estornado' ? 'row-highlight-danger' : ''),
        onAction: (action, row) => {
          if (action === 'receipt') openReceipt(row.id);
          else if (action === 'reverse') reverse(row, () => table.reload());
        },
      });
      btnNovo.addEventListener('click', () => openNewPayment(() => table.reload()));
      await table.load();
    });
  }
})();

/* ==========================================================================
 * dashboard.js
 * ========================================================================== */
/*
 * dashboard.js — Indicadores calculados no banco (RPC dashboard_resumo).
 */
(function () {
  'use strict';
  const { esc, money, pct, date, int } = U;

  function kpi(label, value, sub, variant = '') {
    return `<div class="card kpi ${variant ? 'kpi-' + variant : ''}">
      <div class="kpi-label">${esc(label)}</div><div class="kpi-value">${value}</div>
      ${sub ? `<div class="kpi-sub">${sub}</div>` : ''}</div>`;
  }

  function renderKpis(d) {
    const inad = Number(d.total_devido_vencido) > 0 ? Number(d.vencidas_valor) / Number(d.total_devido_vencido) : 0;
    document.getElementById('kpis').innerHTML = [
      kpi('Contratos ativos', int(d.contratos_ativos), 'em andamento'),
      kpi('Principal concedido', money(d.principal_concedido), 'liberações (exceto canceladas)', 'accent'),
      kpi('Principal a receber', money(d.saldo_principal), `Saldo total em aberto: ${money(d.saldo_aberto)}`),
      kpi('Recebido no mês', money(d.recebido_mes), 'pagamentos confirmados', 'success'),
      kpi('Parcelas vencidas', int(d.vencidas_qtd), `${money(d.vencidas_valor)} em atraso`, Number(d.vencidas_qtd) ? 'danger' : 'success'),
      kpi(`Vencem em ${d.dias_alerta} dias`, int(d.a_vencer_qtd), money(d.a_vencer_valor), 'warning'),
      kpi('Taxa de inadimplência', pct(inad), 'vencido em aberto ÷ total já vencido', inad > 0.1 ? 'danger' : inad > 0.03 ? 'warning' : 'success'),
      kpi('Saldo de caixa', money(d.saldo_caixa), 'movimentações realizadas', Number(d.saldo_caixa) < 0 ? 'danger' : ''),
    ].join('');
  }

  function renderCharts(d) {
    const rec = d.recebimentos_mensais || [];
    U.chart(document.getElementById('chart-receb'), {
      type: 'bar',
      data: {
        labels: rec.map((r) => U.monthLabel(r.mes)),
        datasets: [
          { label: 'Principal', data: rec.map((r) => Number(r.principal)), backgroundColor: U.COLORS.primary, stack: 's' },
          { label: 'Juros', data: rec.map((r) => Number(r.juros)), backgroundColor: U.COLORS.accent, stack: 's' },
          { label: 'Encargos', data: rec.map((r) => Number(r.encargos)), backgroundColor: U.COLORS.warning, stack: 's' },
        ],
      },
      options: { maintainAspectRatio: false, plugins: { tooltip: U.chartMoneyTooltip, legend: { position: 'bottom' } },
                 scales: { y: { stacked: true, ticks: U.chartMoneyTicks }, x: { stacked: true } } },
    });

    const fl = d.fluxo_mensal || [];
    U.chart(document.getElementById('chart-fluxo'), {
      type: 'bar',
      data: {
        labels: fl.map((r) => U.monthLabel(r.mes)),
        datasets: [
          { label: 'Entradas realizadas', data: fl.map((r) => Number(r.entradas_realizadas)), backgroundColor: U.COLORS.success, stack: 'r' },
          { label: 'Saídas realizadas', data: fl.map((r) => -Number(r.saidas_realizadas)), backgroundColor: U.COLORS.danger, stack: 'r' },
          { label: 'Entradas previstas', data: fl.map((r) => Number(r.entradas_previstas)), backgroundColor: 'rgba(26,127,75,.3)', borderColor: U.COLORS.success, borderWidth: 1, stack: 'p' },
          { label: 'Saídas previstas', data: fl.map((r) => -Number(r.saidas_previstas)), backgroundColor: 'rgba(180,35,24,.25)', borderColor: U.COLORS.danger, borderWidth: 1, stack: 'p' },
        ],
      },
      options: { maintainAspectRatio: false,
                 plugins: { legend: { position: 'bottom' },
                            tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${money(Math.abs(c.parsed.y))}` } } },
                 scales: { y: { stacked: true, ticks: U.chartMoneyTicks }, x: { stacked: true } } },
    });
  }

  function renderLists(d) {
    const venc = d.proximos_vencimentos || [];
    document.getElementById('list-venc').innerHTML = venc.length
      ? `<ul class="list">${venc.map((p) => `<li>
          <div><div class="primary-text">${esc(p.cliente_nome)}</div>
            <div class="secondary-text">Contrato nº ${esc(p.contrato_numero)} · parcela ${esc(p.numero)}/${esc(p.qtd_parcelas)} · ${date(p.vencimento)}</div></div>
          <div class="right"><div class="primary-text">${money(p.saldo)}</div>
            ${p.vencida ? U.badge('Vencida', 'danger') : U.badge('A vencer', 'warning')}</div></li>`).join('')}</ul>`
      : U.emptyHTML('Nenhum vencimento próximo', `Não há parcelas vencidas nem vencendo nos próximos ${d.dias_alerta} dias.`);

    const mov = d.ultimas_movimentacoes || [];
    document.getElementById('list-mov').innerHTML = mov.length
      ? `<ul class="list">${mov.map((m) => `<li>
          <div><div class="primary-text">${esc(U.LABELS.categoria[m.categoria] || m.categoria)}</div>
            <div class="secondary-text">${date(m.data)} · ${esc(m.descricao || '')}</div></div>
          <div class="right"><div class="primary-text ${m.tipo === 'entrada' ? 'text-success' : 'text-danger'}">${m.tipo === 'entrada' ? '+' : '−'} ${money(m.valor)}</div>
            ${U.statusBadge('movSituacao', m.situacao)}</div></li>`).join('')}</ul>`
      : U.emptyHTML('Sem movimentações', 'As liberações e recebimentos aparecerão aqui.');
  }

  async function load() {
    const kpis = document.getElementById('kpis');
    kpis.innerHTML = Array.from({ length: 8 }, () =>
      '<div class="card kpi"><div class="skeleton" style="width:60%"></div><div class="skeleton mt-1" style="height:1.6em"></div></div>').join('');
    document.getElementById('list-venc').innerHTML = U.loadingHTML();
    document.getElementById('list-mov').innerHTML = U.loadingHTML();
    try {
      const d = await U.rpc('dashboard_resumo');
      renderKpis(d);
      renderCharts(d);
      renderLists(d);
    } catch (err) {
      console.error(err);
      kpis.innerHTML = `<div class="card span-2">${U.errorHTML(U.errorMessage(err))}</div>`;
      document.getElementById('list-venc').innerHTML = '';
      document.getElementById('list-mov').innerHTML = '';
    }
  }

  App.page('dashboard', 'Painel', async () => {
    if (!Auth.can('contratos.write')) document.getElementById('btn-novo-contrato').classList.add('hidden');
    document.getElementById('btn-refresh').addEventListener('click', load);
    document.getElementById('kpis').addEventListener('click', (e) => { if (e.target.closest('[data-action=retry]')) load(); });
    await load();
  });
})();

/* ==========================================================================
 * clientes.js
 * ========================================================================== */
/*
 * clientes.js — Cadastro, edição, consulta, arquivamento e anonimização (LGPD).
 * Escrita via RPC salvar_cliente (validação no banco); CPF em claro só via
 * revelar_cpf (acesso registrado em auditoria).
 */
(function () {
  'use strict';
  const { esc, date } = U;
  const COLS = 'id, nome, cpf_mascarado, telefone, email, endereco, data_cadastro, status, observacoes, consentimento_lgpd, consentimento_em, anonimizado_em, created_at';
  let table;

  function actions(r) {
    const b = [];
    if (Auth.can('clientes.write') && !r.anonimizado_em) b.push(`<button class="btn btn-sm" data-action="edit">Editar</button>`);
    b.push(`<button class="btn btn-sm" data-action="history">Contratos</button>`);
    if (Auth.can('contratos.write') && r.status === 'ativo') b.push(`<a class="btn btn-sm" href="#contratos?novo=${encodeURIComponent(r.id)}">Novo contrato</a>`);
    if (Auth.can('clientes.write') && !r.anonimizado_em) {
      b.push(r.status === 'arquivado'
        ? `<button class="btn btn-sm" data-action="unarchive">Reativar</button>`
        : `<button class="btn btn-sm" data-action="archive">Arquivar</button>`);
    }
    if (Auth.can('clientes.anonimizar') && r.status === 'arquivado' && !r.anonimizado_em) {
      b.push(`<button class="btn btn-sm btn-danger" data-action="anonymize">Anonimizar</button>`);
    }
    return `<div class="btn-group">${b.join('')}</div>`;
  }

  function openForm(row) {
    const edit = !!row;
    const m = U.modal({
      title: edit ? 'Editar cliente' : 'Novo cliente',
      size: 'lg',
      body: `<form id="form-cliente" novalidate>
        <div class="form-grid">
          <div class="field full"><label for="c-nome">Nome completo <span class="req">*</span></label>
            <input type="text" id="c-nome" name="nome" maxlength="150" required value="${esc(row ? row.nome : '')}"><span class="error-msg"></span></div>
          <div class="field"><label for="c-cpf">CPF</label>
            <div class="input-group">
              <input type="text" id="c-cpf" name="cpf" inputmode="numeric" maxlength="14" autocomplete="off"
                placeholder="${edit && row.cpf_mascarado ? esc(row.cpf_mascarado) + ' (manter)' : '000.000.000-00'}">
              ${edit && row.cpf_mascarado && Auth.can('clientes.cpf') ? '<button type="button" class="btn" id="btn-revelar">Revelar</button>' : ''}
            </div>
            <span class="hint">${edit ? 'Deixe em branco para manter o CPF atual.' : 'Opcional. Informe quando necessário para a operação.'}</span>
            <span class="error-msg"></span></div>
          <div class="field"><label for="c-tel">Telefone</label>
            <input type="text" id="c-tel" name="telefone" inputmode="tel" maxlength="16" value="${esc(row && row.telefone ? U.formatPhone(row.telefone) : '')}" placeholder="(00) 00000-0000"><span class="error-msg"></span></div>
          <div class="field"><label for="c-email">E-mail</label>
            <input type="email" id="c-email" name="email" maxlength="150" value="${esc(row ? row.email || '' : '')}"><span class="error-msg"></span></div>
          <div class="field full"><label for="c-end">Endereço</label>
            <input type="text" id="c-end" name="endereco" maxlength="300" value="${esc(row ? row.endereco || '' : '')}"
              placeholder="Rua, número, bairro, cidade/UF, CEP">
            <span class="hint">Aparece no campo "Endereço" do emitente na nota promissória.</span></div>
          <div class="field"><label for="c-data">Data de cadastro</label>
            <input type="date" id="c-data" name="data_cadastro" max="${U.today()}" value="${esc(row ? row.data_cadastro : U.today())}"><span class="error-msg"></span></div>
          <div class="field"><label for="c-status">Status</label>
            <select id="c-status" name="status">${U.options({ ativo: 'Ativo', inativo: 'Inativo', arquivado: 'Arquivado' }, row ? row.status : 'ativo')}</select></div>
          ${edit && row.cpf_mascarado ? `<div class="field"><label class="checkbox"><input type="checkbox" name="remover_cpf"> Remover CPF do cadastro</label></div>` : ''}
          <div class="field full"><label for="c-obs">Observações</label>
            <textarea id="c-obs" name="observacoes" maxlength="2000">${esc(row ? row.observacoes || '' : '')}</textarea>
            <span class="hint">Não registre dados sensíveis (saúde, religião, etc.).</span></div>
          <div class="field full"><label class="checkbox"><input type="checkbox" name="consentimento" ${row && row.consentimento_lgpd ? 'checked' : ''}>
            <span>O titular foi informado sobre o tratamento dos seus dados pessoais (aviso de privacidade / LGPD). <span class="req">*</span></span></label>
            <span class="error-msg"></span></div>
        </div></form>`,
      footer: `<button type="button" class="btn" data-close>Cancelar</button><button type="submit" form="form-cliente" class="btn btn-primary">Salvar</button>`,
    });
    const form = m.el.querySelector('form');

    const revelar = m.el.querySelector('#btn-revelar');
    if (revelar) {
      revelar.addEventListener('click', async () => {
        U.busy(revelar, true, '');
        try {
          const cpf = await U.rpc('revelar_cpf', { p_cliente_id: row.id });
          form.cpf.value = U.formatCPF(cpf || '');
          U.toast('CPF exibido. Este acesso foi registrado na auditoria.', 'info');
        } catch (err) { U.toast(U.errorMessage(err), 'error'); }
        U.busy(revelar, false);
      });
    }
    form.cpf.addEventListener('blur', () => { if (form.cpf.value) form.cpf.value = U.formatCPF(form.cpf.value); });
    form.telefone.addEventListener('blur', () => { if (U.digits(form.telefone.value)) form.telefone.value = U.formatPhone(form.telefone.value); });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      U.clearErrors(form);
      const nome = form.nome.value.trim().replace(/\s+/g, ' ');
      const cpf = U.digits(form.cpf.value);
      const tel = U.digits(form.telefone.value);
      const email = form.email.value.trim().toLowerCase();
      let ok = true;
      if (nome.length < 3) { U.fieldError(form, 'nome', 'Informe o nome completo (mínimo 3 caracteres).'); ok = false; }
      if (cpf && !U.validCPF(cpf)) { U.fieldError(form, 'cpf', 'CPF inválido.'); ok = false; }
      if (tel && (tel.length < 10 || tel.length > 11)) { U.fieldError(form, 'telefone', 'Telefone deve ter DDD + número (10 ou 11 dígitos).'); ok = false; }
      if (email && !U.validEmail(email)) { U.fieldError(form, 'email', 'E-mail inválido.'); ok = false; }
      if (form.data_cadastro.value && form.data_cadastro.value > U.today()) { U.fieldError(form, 'data_cadastro', 'A data não pode ser futura.'); ok = false; }
      if (!form.consentimento.checked) { U.fieldError(form, 'consentimento', 'Confirme que o titular foi informado sobre o tratamento de dados.'); ok = false; }
      if (!ok) { U.focusFirstError(form); return; }

      let pCpf = cpf || null;
      if (edit) {
        if (form.remover_cpf && form.remover_cpf.checked) pCpf = '';
        else if (!cpf) pCpf = null; // mantém
      }
      const btn = m.el.querySelector('button[type=submit]');
      U.busy(btn, true, 'Salvando...');
      try {
        await U.rpc('salvar_cliente', {
          p_id: edit ? row.id : null, p_nome: nome, p_cpf: pCpf, p_telefone: tel || null, p_email: email || null,
          p_data_cadastro: form.data_cadastro.value || null, p_status: form.status.value,
          p_observacoes: form.observacoes.value.trim() || null, p_consentimento: form.consentimento.checked,
          p_endereco: form.endereco.value.trim() || null,
        });
        U.toast(edit ? 'Cliente atualizado com sucesso.' : 'Cliente cadastrado com sucesso.', 'success');
        m.close();
        table.reload();
      } catch (err) {
        U.busy(btn, false);
        const msg = U.errorMessage(err);
        if (/cpf/i.test(msg)) U.fieldError(form, 'cpf', msg);
        U.toast(msg, 'error');
      }
    });
    form.nome.focus();
  }

  async function openHistory(row) {
    const m = U.modal({ title: `Contratos — ${row.nome}`, size: 'lg', body: U.loadingHTML() });
    try {
      const { data, error } = await Auth.client.from('vw_contratos')
        .select('id, numero, data_contratacao, principal, qtd_parcelas, valor_parcela, status, saldo_aberto, parcelas_vencidas, parcelas_pagas')
        .eq('cliente_id', row.id).order('data_contratacao', { ascending: false });
      if (error) throw error;
      if (!data.length) { m.body.innerHTML = U.emptyHTML('Nenhum contrato', 'Este cliente ainda não possui contratos.'); return; }
      const totalSaldo = data.reduce((a, c) => a + Number(c.saldo_aberto), 0);
      m.body.innerHTML = `<div class="summary-grid">
          <div class="summary-item"><div class="label">Contratos</div><div class="value">${data.length}</div></div>
          <div class="summary-item"><div class="label">Ativos</div><div class="value">${data.filter((c) => c.status === 'ativo').length}</div></div>
          <div class="summary-item"><div class="label">Saldo em aberto</div><div class="value">${U.money(totalSaldo)}</div></div>
        </div>
        <div class="table-wrap"><table class="table table-compact responsive"><thead><tr>
          <th>Nº</th><th>Data</th><th class="num">Principal</th><th>Parcelas</th><th class="num">Saldo</th><th>Status</th><th></th></tr></thead><tbody>
          ${data.map((c) => `<tr><td data-label="Nº">${esc(c.numero)}</td><td data-label="Data">${date(c.data_contratacao)}</td>
            <td data-label="Principal" class="num">${U.money(c.principal)}</td>
            <td data-label="Parcelas">${esc(c.parcelas_pagas)}/${esc(c.qtd_parcelas)} pagas${Number(c.parcelas_vencidas) ? ' ' + U.badge(c.parcelas_vencidas + ' vencida(s)', 'danger') : ''}</td>
            <td data-label="Saldo" class="num">${U.money(c.saldo_aberto)}</td>
            <td data-label="Status">${U.statusBadge('contratoStatus', c.status)}</td>
            <td class="actions"><a class="btn btn-sm" href="#contratos?contrato=${encodeURIComponent(c.id)}">Abrir</a></td></tr>`).join('')}
        </tbody></table></div>`;
    } catch (err) {
      m.body.innerHTML = U.errorHTML(U.errorMessage(err), false);
    }
  }

  async function changeStatus(row, status) {
    const archive = status === 'arquivado';
    const ok = await U.confirm({
      title: archive ? 'Arquivar cliente' : 'Reativar cliente',
      message: archive
        ? `Arquivar "${row.nome}"? O cadastro deixa de aparecer na lista padrão, mas o histórico é preservado.`
        : `Reativar "${row.nome}"?`,
      confirmText: archive ? 'Arquivar' : 'Reativar',
    });
    if (!ok) return;
    try {
      await U.rpc('alterar_status_cliente', { p_id: row.id, p_status: status });
      U.toast(archive ? 'Cliente arquivado.' : 'Cliente reativado.', 'success');
      table.reload();
    } catch (err) { U.toast(U.errorMessage(err), 'error'); }
  }

  async function anonymize(row) {
    const ok = await U.confirm({
      title: 'Anonimizar cliente (LGPD)',
      html: true,
      message: `<div class="alert alert-danger">Esta ação é <strong>irreversível</strong>. Nome, CPF, telefone, e-mail e observações de
        <strong>${esc(row.nome)}</strong> serão apagados. Contratos e pagamentos permanecem para cumprimento de obrigações legais.</div>
        <p class="small muted">Use para atender pedidos de eliminação do titular quando não houver base legal para retenção.</p>`,
      confirmText: 'Anonimizar definitivamente',
      danger: true,
      reason: { label: 'Registro do pedido do titular', minLength: 10, placeholder: 'Ex.: pedido recebido por e-mail em 10/03/2026, protocolo 123' },
    });
    if (!ok) return;
    try {
      await U.rpc('anonimizar_cliente', { p_cliente_id: row.id, p_motivo: ok.reason });
      U.toast('Cliente anonimizado. Registro mantido na auditoria.', 'success');
      table.reload();
    } catch (err) { U.toast(U.errorMessage(err), 'error'); }
  }

  App.page('clientes', 'Clientes', async () => {
    const btnNovo = document.getElementById('btn-novo');
    btnNovo.innerHTML = `${U.icon('plus')} Novo cliente`;
    if (!Auth.can('clientes.write')) btnNovo.classList.add('hidden');
    btnNovo.addEventListener('click', () => openForm(null));

    table = new DataTable({
      container: document.getElementById('tbl-clientes'),
      searchPlaceholder: 'Buscar por nome, e-mail ou telefone',
      filters: [{ key: 'status', label: 'Status', type: 'select', value: 'ativo', options: [
        { value: 'ativo', label: 'Ativos' }, { value: 'inativo', label: 'Inativos' },
        { value: 'arquivado', label: 'Arquivados' }, { value: '', label: 'Todos' }] }],
      emptyTitle: 'Nenhum cliente encontrado',
      emptyText: 'Ajuste os filtros ou cadastre um novo cliente.',
      columns: [
        { label: 'Nome', render: (r) => `<strong>${esc(r.nome)}</strong>${r.anonimizado_em ? ' ' + U.badge('Anonimizado') : ''}` },
        { label: 'CPF', render: (r) => (r.cpf_mascarado ? `<span class="mono">${esc(r.cpf_mascarado)}</span>` : '—') },
        { label: 'Telefone', render: (r) => esc(U.formatPhone(r.telefone)) },
        { label: 'E-mail', render: (r) => esc(r.email || '—') },
        { label: 'Cadastro', render: (r) => date(r.data_cadastro) },
        { label: 'Status', render: (r) => U.statusBadge('clienteStatus', r.status) },
        { label: 'Ações', className: 'actions', render: actions },
      ],
      fetch: async ({ from, to, search, filters }) => {
        let q = Auth.client.from('clientes').select(COLS, { count: 'exact' }).order('nome').range(from, to);
        if (filters.status) q = q.eq('status', filters.status);
        if (search) {
          const d = U.digits(search);
          q = q.or(`nome.ilike.%${search}%,email.ilike.%${search}%` + (d.length >= 4 ? `,telefone.ilike.%${d}%` : ''));
        }
        const { data, error, count } = await q;
        if (error) throw error;
        return { rows: data, total: count };
      },
      onAction: (action, row) => {
        if (action === 'edit') openForm(row);
        else if (action === 'history') openHistory(row);
        else if (action === 'archive') changeStatus(row, 'arquivado');
        else if (action === 'unarchive') changeStatus(row, 'ativo');
        else if (action === 'anonymize') anonymize(row);
      },
    });
    await table.load();
  });
})();

/* ==========================================================================
 * contratos.js
 * ========================================================================== */
/*
 * contratos.js — Lista, simulação, contratação, detalhe, renegociação e cancelamento.
 * A simulação usa js/finance.js (mesmo algoritmo do banco). Na confirmação o
 * servidor recalcula tudo e recusa a operação se o total divergir.
 */
(function () {
  'use strict';
  const { esc, money, date } = U;
  const F = window.Finance;
  let table;

  // ------------------------------------------------------------------ termos
  function maxRateInfo() {
    const max = Auth.org.taxa_juros_max_mensal;
    return max === null || max === undefined ? null : { fraction: String(max), scaled: F.parseDecimal(String(max), 8) };
  }

  function termsHTML({ principal = '', principalLocked = false, extra = '' } = {}) {
    const today = U.today();
    const max = maxRateInfo();
    return `
      <div class="form-grid form-grid-3">
        <div class="field"><label for="t-principal">Principal concedido (R$) <span class="req">*</span></label>
          <input type="text" id="t-principal" name="principal" inputmode="decimal" value="${esc(principal)}" ${principalLocked ? 'readonly' : ''} placeholder="0,00">
          <span class="error-msg"></span></div>
        <div class="field"><label for="t-data">Data da contratação <span class="req">*</span></label>
          <input type="date" id="t-data" name="data" value="${today}"><span class="error-msg"></span></div>
        <div class="field"><label for="t-freq">Frequência <span class="req">*</span></label>
          <select id="t-freq" name="frequencia">${U.options(U.LABELS.frequencia, 'mensal')}</select></div>
        <div class="field"><label for="t-n">Quantidade de parcelas <span class="req">*</span></label>
          <input type="number" id="t-n" name="parcelas" min="1" max="360" step="1" value="12"><span class="error-msg"></span></div>
        <div class="field"><label for="t-primeiro">Primeiro vencimento <span class="req">*</span></label>
          <input type="date" id="t-primeiro" name="primeiro" value="${F.defaultFirstDue(today, 'mensal')}"><span class="error-msg"></span></div>
        <div class="field"><label for="t-sistema">Sistema de amortização <span class="req">*</span></label>
          <select id="t-sistema" name="sistema">${U.options(U.LABELS.sistema, 'PRICE')}</select></div>
        <div class="field"><label for="t-taxa">Taxa de juros (% a.m.) <span class="req">*</span></label>
          <input type="text" id="t-taxa" name="taxa" inputmode="decimal" placeholder="0,00">
          <span class="hint">${max ? `Limite da organização: ${U.pct(max.fraction, 4)} a.m.` : 'Sem limite configurado.'}</span>
          <span class="error-msg"></span></div>
        <div class="field"><label for="t-enc">Encargos (R$)</label>
          <input type="text" id="t-enc" name="encargos" inputmode="decimal" value="0,00">
          <span class="hint">Somente encargos legalmente permitidos (ex.: IOF), diluídos nas parcelas.</span>
          <span class="error-msg"></span></div>
        <div class="field"><label for="t-enc-desc">Descrição dos encargos</label>
          <input type="text" id="t-enc-desc" name="encargos_desc" maxlength="500"><span class="error-msg"></span></div>
        ${extra}
      </div>`;
  }

  /** Lê e valida os termos. Retorna params para Finance.schedule + RPC, ou null. */
  function readTerms(form) {
    U.clearErrors(form);
    let ok = true;
    const principal = U.parseMoney(form.principal.value);
    const taxa = U.parsePercent(form.taxa.value);
    const encargos = U.parseMoney(form.encargos.value || '0') ;
    const n = Number(form.parcelas.value);
    const data = form.data.value;
    const primeiro = form.primeiro.value;
    const today = U.today();
    if (!principal || F.toCents(principal) < 100n) { U.fieldError(form, 'principal', 'Informe um valor válido (mínimo R$ 1,00).'); ok = false; }
    if (!data) { U.fieldError(form, 'data', 'Informe a data.'); ok = false; }
    else if (F.diffDays(today, data) > 30) { U.fieldError(form, 'data', 'No máximo 30 dias no futuro.'); ok = false; }
    if (!Number.isInteger(n) || n < 1 || n > 360) { U.fieldError(form, 'parcelas', 'Entre 1 e 360.'); ok = false; }
    if (!primeiro) { U.fieldError(form, 'primeiro', 'Informe a data.'); ok = false; }
    else if (data && (primeiro <= data || F.diffDays(data, primeiro) > 366)) {
      U.fieldError(form, 'primeiro', 'Deve ser posterior à contratação e em até 1 ano.'); ok = false;
    }
    if (taxa === null) { U.fieldError(form, 'taxa', 'Taxa inválida (ex.: 2,5).'); ok = false; }
    else {
      const max = maxRateInfo();
      if (F.rateFromPercent(taxa) >= F.RATE_SCALE) { U.fieldError(form, 'taxa', 'Taxa deve ser menor que 100% a.m.'); ok = false; }
      else if (max && F.rateFromPercent(taxa) > max.scaled) {
        U.fieldError(form, 'taxa', `Acima do limite configurado (${U.pct(max.fraction, 4)} a.m.).`); ok = false;
      }
    }
    if (encargos === null) { U.fieldError(form, 'encargos', 'Valor inválido.'); ok = false; }
    if (!ok) { U.focusFirstError(form); return null; }
    return {
      principal, taxaMensalPct: taxa, parcelas: n, frequencia: form.frequencia.value, sistema: form.sistema.value,
      encargos, primeiroVencimento: primeiro, dataContratacao: data, encargosDesc: form.encargos_desc.value.trim(),
    };
  }

  function bindTermsAuto(form, onChange) {
    let touched = false;
    form.primeiro.addEventListener('change', () => { touched = true; });
    const updateFirst = () => {
      if (!touched && form.data.value) form.primeiro.value = F.defaultFirstDue(form.data.value, form.frequencia.value);
    };
    form.data.addEventListener('change', updateFirst);
    form.frequencia.addEventListener('change', updateFirst);
    ['principal', 'encargos'].forEach((n) => form[n].addEventListener('blur', () => {
      const v = U.parseMoney(form[n].value);
      if (v !== null && !form[n].readOnly) form[n].value = U.moneyInput(v);
    }));
    form.addEventListener('input', onChange);
    form.addEventListener('change', onChange);
  }

  function simulationHTML(s, p) {
    const first = s.rows[0].total;
    const last = s.rows[s.rows.length - 1].total;
    const parcelaTxt = p.sistema === 'SAC' ? `${money(first)} → ${money(last)}`
      : money(first) + (first !== last ? `<div class="small muted">última ${money(last)}</div>` : '');
    const cetA = F.annualFromMonthly(s.cetMensal);
    return `
      <div class="summary-grid">
        <div class="summary-item"><div class="label">Principal</div><div class="value">${money(F.toCents(p.principal))}</div></div>
        <div class="summary-item"><div class="label">Juros</div><div class="value">${money(s.totalJuros)}</div></div>
        <div class="summary-item"><div class="label">Encargos</div><div class="value">${money(s.totalEncargos)}</div></div>
        <div class="summary-item"><div class="label">Total a pagar</div><div class="value">${money(s.total)}</div></div>
        <div class="summary-item"><div class="label">Parcela</div><div class="value">${parcelaTxt}</div></div>
        <div class="summary-item"><div class="label">Taxa do período</div><div class="value">${U.pct(Number(s.taxaPeriodo) / 1e8, 4)}</div></div>
        <div class="summary-item"><div class="label">CET</div><div class="value">${s.cetMensal === null ? '—' : `${U.pct(s.cetMensal)} a.m.`}</div>
          <div class="small muted">${cetA === null ? '' : `${U.pct(cetA)} a.a.`}</div></div>
      </div>
      <div class="table-wrap" style="max-height:320px;overflow:auto"><table class="table table-compact responsive">
        <thead><tr><th>Nº</th><th>Vencimento</th><th class="num">Saldo inicial</th><th class="num">Amortização</th>
          <th class="num">Juros</th><th class="num">Encargos</th><th class="num">Parcela</th></tr></thead>
        <tbody>${s.rows.map((r) => `<tr><td data-label="Nº">${r.numero}</td><td data-label="Vencimento">${date(r.vencimento)}</td>
          <td data-label="Saldo inicial" class="num">${money(r.saldoInicial)}</td><td data-label="Amortização" class="num">${money(r.principal)}</td>
          <td data-label="Juros" class="num">${money(r.juros)}</td><td data-label="Encargos" class="num">${money(r.encargos)}</td>
          <td data-label="Parcela" class="num"><strong>${money(r.total)}</strong></td></tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="3">Totais</td><td class="num">${money(s.totalPrincipal)}</td><td class="num">${money(s.totalJuros)}</td>
          <td class="num">${money(s.totalEncargos)}</td><td class="num">${money(s.total)}</td></tr></tfoot>
      </table></div>
      <p class="small muted mt-1">Simulação calculada com precisão decimal. Na confirmação, o servidor recalcula o cronograma e recusa
        a operação se houver divergência. A conformidade da taxa, dos encargos e do CET com a legislação aplicável é responsabilidade da organização.</p>`;
  }

  /** Controla simular → confirmar; confirmação só fica ativa para a simulação vigente. */
  function simulationController(m, form, onConfirm) {
    const out = m.el.querySelector('.sim-out');
    const btnSim = m.el.querySelector('[data-simulate]');
    const btnOk = m.el.querySelector('[data-confirm]');
    let current = null;
    const stale = () => {
      if (!current) return;
      current = null;
      btnOk.disabled = true;
      out.insertAdjacentHTML('afterbegin', '<div class="alert alert-warning sim-stale">Os dados mudaram. Simule novamente antes de confirmar.</div>');
    };
    bindTermsAuto(form, () => { if (current && !out.querySelector('.sim-stale')) stale(); });
    btnSim.addEventListener('click', () => {
      const p = readTerms(form);
      if (!p) return;
      try {
        const s = F.schedule(p);
        current = { p, s };
        out.innerHTML = simulationHTML(s, p);
        btnOk.disabled = false;
        out.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (err) {
        out.innerHTML = `<div class="alert alert-danger">${esc(err.message)}</div>`;
      }
    });
    btnOk.addEventListener('click', async () => {
      if (!current) return;
      await onConfirm(current, btnOk);
    });
  }

  function rpcTerms({ p, s }) {
    return {
      p_data_contratacao: p.dataContratacao,
      p_primeiro_vencimento: p.primeiroVencimento,
      p_qtd_parcelas: p.parcelas,
      p_frequencia: p.frequencia,
      p_taxa_juros_mensal: F.rateToString(F.rateFromPercent(p.taxaMensalPct)),
      p_sistema: p.sistema,
      p_encargos: F.centsToString(F.toCents(p.encargos)),
      p_descricao_encargos: p.encargosDesc || null,
      p_total_esperado: F.centsToString(s.total),
    };
  }

  const complianceAlert = () => '';

  // ------------------------------------------------------------------ novo contrato
  async function openNew(preselectClientId) {
    const m = U.modal({
      title: 'Novo contrato',
      size: 'xl',
      body: `${complianceAlert()}<form id="form-contrato" novalidate>
          <div class="form-grid mb-2">
            <div class="field full"><label for="t-cliente">Cliente <span class="req">*</span></label>
              <div class="input-group"><input type="search" id="t-cliente-busca" placeholder="Filtrar clientes..." aria-label="Filtrar clientes" style="max-width:220px">
              <select id="t-cliente" name="cliente"><option value="">Carregando clientes...</option></select></div>
              <span class="error-msg"></span></div>
          </div>
          ${termsHTML({ extra: `<div class="field full"><label for="t-obs">Observações</label><textarea id="t-obs" name="observacoes" maxlength="2000"></textarea></div>` })}
        </form>
        <div class="sim-out mt-2"></div>`,
      footer: `<button type="button" class="btn" data-close>Cancelar</button>
        <button type="button" class="btn" data-simulate>Simular</button>
        <button type="button" class="btn btn-primary" data-confirm disabled>Confirmar contratação</button>`,
    });
    const form = m.el.querySelector('form');
    const sel = form.cliente;
    let clientes = [];
    try {
      const { data, error } = await Auth.client.from('clientes').select('id, nome, cpf_mascarado, telefone')
        .eq('status', 'ativo').order('nome').limit(2000);
      if (error) throw error;
      clientes = data;
    } catch (err) { U.toast(U.errorMessage(err), 'error'); }
    const renderOptions = (filter = '') => {
      const f = filter.toLowerCase();
      const list = clientes.filter((c) => !f || c.nome.toLowerCase().includes(f) || (c.cpf_mascarado || '').includes(f));
      sel.innerHTML = `<option value="">${list.length ? 'Selecione o cliente' : 'Nenhum cliente ativo encontrado'}</option>` +
        list.map((c) => `<option value="${esc(c.id)}"${c.id === preselectClientId ? ' selected' : ''}>${esc(c.nome)}${c.cpf_mascarado ? ' — ' + esc(c.cpf_mascarado) : ' (sem CPF)'}</option>`).join('');
    };
    renderOptions();
    m.el.querySelector('#t-cliente-busca').addEventListener('input', (e) => renderOptions(e.target.value));

    simulationController(m, form, async (sim, btn) => {
      U.clearErrors(form);
      if (!sel.value) { U.fieldError(form, 'cliente', 'Selecione o cliente.'); sel.focus(); return; }
      const cliente = clientes.find((x) => x.id === sel.value);
      if (cliente && !cliente.cpf_mascarado) {
        U.fieldError(form, 'cliente', 'Cadastre o CPF deste cliente (Clientes → Editar): é necessário para a nota promissória e a assinatura.');
        sel.focus();
        return;
      }
      const nome = sel.options[sel.selectedIndex].text;
      const ok = await U.confirm({
        title: 'Confirmar e enviar para assinatura',
        html: true,
        message: `<p>Cliente: <strong>${esc(nome)}</strong></p>
          <p>Principal: <strong>${money(F.toCents(sim.p.principal))}</strong> em <strong>${sim.p.parcelas}x</strong>
          (${esc(U.LABELS.frequencia[sim.p.frequencia].toLowerCase())}, ${esc(sim.p.sistema)}) · Total a pagar: <strong>${money(sim.s.total)}</strong></p>
          <p class="small muted">O contrato ficará <strong>aguardando a assinatura do cliente</strong>. Em seguida você poderá enviar o link
          pelo WhatsApp. As parcelas e a liberação no caixa só são registradas quando o cliente assinar.</p>`,
        confirmText: 'Criar e gerar link',
      });
      if (!ok) return;
      U.busy(btn, true, 'Criando...');
      try {
        const id = await U.rpc('criar_contrato', Object.assign({
          p_cliente_id: sel.value,
          p_principal: F.centsToString(F.toCents(sim.p.principal)),
          p_observacoes: form.observacoes.value.trim() || null,
        }, rpcTerms(sim)));
        U.toast('Contrato criado. Envie o link para o cliente assinar.', 'success');
        m.close();
        table.reload();
        openDetail(id, { enviar: true });
      } catch (err) {
        U.busy(btn, false);
        U.toast(U.errorMessage(err), 'error', 9000);
      }
    });
  }

  // ------------------------------------------------------------------ detalhe
  async function openDetail(id, opts = {}) {
    const m = U.modal({ title: 'Contrato', size: 'xl', body: U.loadingHTML() });
    let primeiraVez = true;
    async function render() {
      m.body.innerHTML = U.loadingHTML();
      try {
        const [c, parc, pags, ass] = await Promise.all([
          Auth.client.from('vw_contratos').select('*').eq('id', id).single(),
          Auth.client.from('vw_parcelas').select('*').eq('contrato_id', id).order('numero'),
          Auth.client.from('vw_pagamentos').select('*').eq('contrato_id', id).order('created_at', { ascending: false }),
          Auth.client.from('assinaturas').select('status, expira_em, assinado_em, nome_assinante, tentativas, ip, created_at')
            .eq('contrato_id', id).order('created_at', { ascending: false }).limit(1),
        ]);
        for (const r of [c, parc, pags, ass]) if (r.error) throw r.error;
        renderDetail(m, c.data, parc.data, pags.data, ass.data[0] || null, render);
        if (primeiraVez && opts.enviar && c.data.status === 'pendente_assinatura') openEnvio(c.data, render);
        primeiraVez = false;
      } catch (err) {
        m.body.innerHTML = U.errorHTML(U.errorMessage(err), false);
      }
    }
    await render();
  }

  function assinaturaHTML(c, a) {
    if (c.status === 'pendente_assinatura') {
      const situacao = !a ? 'Nenhum link enviado ainda.'
        : a.status === 'pendente' && new Date(a.expira_em) < new Date() ? `Link expirado em ${esc(U.datetime(a.expira_em))}. Gere um novo link.`
        : a.status === 'pendente' ? `Link enviado em ${esc(U.datetime(a.created_at))}, válido até ${esc(U.datetime(a.expira_em))}.`
        : a.status === 'cancelado' ? 'O último link foi cancelado (novo link gerado ou tentativas incorretas). Gere um novo link.' : '';
      return `<div class="alert alert-warning"><strong>Aguardando assinatura do cliente.</strong> ${situacao}
        As parcelas e a liberação no caixa serão registradas quando o cliente assinar.</div>`;
    }
    if (a && a.status === 'assinado') {
      return `<div class="alert alert-success"><strong>Assinado pelo cliente</strong> em ${esc(U.datetime(a.assinado_em))}
        por ${esc(a.nome_assinante)}${a.ip ? ` · IP ${esc(a.ip)}` : ''}.</div>`;
    }
    return '';
  }

  /** Gera o link de assinatura e oferece o envio pelo WhatsApp. */
  async function openEnvio(c, onDone) {
    const m = U.modal({ title: `Enviar contrato nº ${c.numero} para assinatura`, size: 'lg', body: U.loadingHTML('Gerando link...') });
    try {
      const [link, cli] = await Promise.all([
        U.rpc('gerar_link_assinatura', { p_contrato_id: c.id }),
        Auth.client.from('clientes').select('nome, telefone').eq('id', c.cliente_id).single(),
      ]);
      if (cli.error) throw cli.error;
      if (onDone) onDone();
      const url = `${location.origin}${location.pathname}#assinar?t=${link.token}`;
      const telefone = cli.data.telefone;
      const msg = U.mensagemAssinatura({ cliente: cli.data, org: Auth.org, contrato: c, link: url, expira: link.expira_em });
      m.body.innerHTML = `
        <p>Envie o link ao cliente. Ao abrir, ele verá as <strong>${c.qtd_parcelas} notas promissórias</strong> (uma por parcela),
          confirmará o CPF e assinará na tela. Gerar um novo link invalida o anterior.</p>
        <div class="field mb-2"><label for="env-link">Link de assinatura</label>
          <div class="link-box"><input type="text" id="env-link" readonly value="${esc(url)}">
          <button type="button" class="btn" data-copy="link">Copiar</button></div>
          <span class="hint">Válido até ${esc(U.datetime(link.expira_em))}.</span></div>
        <div class="field"><label for="env-msg">Mensagem</label>
          <textarea id="env-msg" rows="12">${esc(msg)}</textarea>
          <span class="hint">Você pode editar a mensagem antes de enviar.</span></div>
        ${telefone ? `<p class="small muted mt-1">WhatsApp do cliente: <strong>${esc(U.formatPhone(telefone))}</strong></p>`
          : `<div class="alert alert-warning mt-1">Este cliente não tem telefone cadastrado. Cadastre em Clientes → Editar, ou copie a mensagem e envie por outro meio.</div>`}`;
      let footer = m.el.querySelector('.modal-footer');
      if (!footer) {
        footer = document.createElement('div');
        footer.className = 'modal-footer';
        m.el.querySelector('.modal-inner').appendChild(footer);
      }
      footer.innerHTML = `<button type="button" class="btn" data-close>Fechar</button>
        <button type="button" class="btn" data-copy="msg">Copiar mensagem</button>
        ${telefone ? `<a class="btn btn-whatsapp" id="env-wa" target="_blank" rel="noopener noreferrer">Enviar pelo WhatsApp</a>` : ''}`;
      const ta = m.body.querySelector('#env-msg');
      const wa = footer.querySelector('#env-wa');
      const atualizar = () => { if (wa) wa.href = U.whatsappUrl(telefone, ta.value) || '#'; };
      ta.addEventListener('input', atualizar);
      atualizar();
      m.el.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
        const texto = b.dataset.copy === 'link' ? url : ta.value;
        try {
          await navigator.clipboard.writeText(texto);
        } catch (_) {
          const el = b.dataset.copy === 'link' ? m.body.querySelector('#env-link') : ta;
          el.select();
          document.execCommand('copy');
        }
        U.toast(b.dataset.copy === 'link' ? 'Link copiado.' : 'Mensagem copiada.', 'success', 2500);
      }));
    } catch (err) {
      m.body.innerHTML = U.errorHTML(U.errorMessage(err), false);
    }
  }

  /** Assinatura do cliente: imagem e evidências (data/hora, IP, navegador). */
  async function openAssinatura(c) {
    const m = U.modal({ title: `Assinatura — contrato nº ${c.numero}`, size: 'lg', body: U.loadingHTML(),
      footer: '<button type="button" class="btn" data-close>Fechar</button>' });
    try {
      const { data, error } = await Auth.client.from('assinaturas')
        .select('status, assinado_em, nome_assinante, assinatura_imagem, ip, user_agent, tentativas, created_at')
        .eq('contrato_id', c.id).eq('status', 'assinado').order('assinado_em', { ascending: false }).limit(1);
      if (error) throw error;
      const a = data[0];
      if (!a) { m.body.innerHTML = U.emptyHTML('Contrato ainda não assinado'); return; }
      m.body.innerHTML = `
        <div class="assinatura-box">${a.assinatura_imagem && /^data:image\/png;base64,/.test(a.assinatura_imagem)
          ? `<img src="${esc(a.assinatura_imagem)}" alt="Assinatura de ${esc(a.nome_assinante)}">` : U.emptyHTML('Imagem indisponível')}</div>
        <dl class="dl mt-2">
          <dt>Assinado por</dt><dd>${esc(a.nome_assinante)} (CPF conferido com o cadastro)</dd>
          <dt>Data e hora</dt><dd>${esc(U.datetime(a.assinado_em))}</dd>
          <dt>Link enviado em</dt><dd>${esc(U.datetime(a.created_at))}</dd>
          <dt>Endereço IP</dt><dd class="mono">${esc(a.ip || 'não registrado')}</dd>
          <dt>Navegador</dt><dd class="small">${esc(a.user_agent || 'não registrado')}</dd>
          <dt>Tentativas de CPF incorretas</dt><dd>${esc(a.tentativas)}</dd>
        </dl>`;
    } catch (err) {
      m.body.innerHTML = U.errorHTML(U.errorMessage(err), false);
    }
  }

  /** Notas promissórias do contrato (modelo tradicional), com assinatura quando houver. */
  async function openNotas(c) {
    const m = U.modal({ title: `Notas promissórias — contrato nº ${c.numero}`, size: 'xl', body: U.loadingHTML(),
      footer: `<button type="button" class="btn" data-close>Fechar</button>
        <button type="button" class="btn btn-primary" data-print disabled>${U.icon('printer')} Imprimir / PDF</button>` });
    try {
      const d = await U.rpc('notas_promissorias', { p_contrato_id: c.id });
      const a = d.assinatura;
      m.body.innerHTML = `${a && a.status === 'assinado'
          ? `<div class="alert alert-success">Assinadas em ${esc(U.datetime(a.assinado_em))} por ${esc(a.nome_assinante)}.</div>`
          : '<div class="alert alert-warning">Ainda não assinadas pelo cliente.</div>'}
        ${d.organizacao.praca_pagamento ? '' : '<div class="alert alert-info">Dica: informe a praça de pagamento ("pagável em") em Configurações → Organização.</div>'}
        ${U.notasPromissorias(d)}`;
      const btn = m.el.querySelector('[data-print]');
      btn.disabled = false;
      btn.addEventListener('click', () => U.printModal());
    } catch (err) {
      m.body.innerHTML = U.errorHTML(U.errorMessage(err), false);
    }
  }

  function renderDetail(m, c, parcelas, pagamentos, assinatura, refresh) {
    m.el.querySelector('h2').textContent = `Contrato nº ${c.numero} — ${c.cliente_nome}`;
    const canPay = Auth.can('pagamentos.write') && c.status === 'ativo';
    const pendente = c.status === 'pendente_assinatura';
    const cetA = c.cet_mensal === null ? null : F.annualFromMonthly(Number(c.cet_mensal));
    m.body.innerHTML = `
      ${assinaturaHTML(c, assinatura)}
      <div class="summary-grid">
        <div class="summary-item"><div class="label">Status</div><div class="value">${U.statusBadge('contratoStatus', c.status)}</div></div>
        <div class="summary-item"><div class="label">Principal</div><div class="value">${money(c.principal)}</div></div>
        <div class="summary-item"><div class="label">Total projetado</div><div class="value">${money(c.total_projetado)}</div></div>
        <div class="summary-item"><div class="label">Total pago</div><div class="value text-success">${money(c.total_pago)}</div></div>
        <div class="summary-item"><div class="label">Saldo em aberto</div><div class="value">${money(c.saldo_aberto)}</div></div>
        <div class="summary-item"><div class="label">Principal a receber</div><div class="value">${money(c.saldo_principal)}</div></div>
      </div>
      <dl class="dl">
        <dt>Cliente</dt><dd>${esc(c.cliente_nome)}</dd>
        <dt>Contratação</dt><dd>${date(c.data_contratacao)} · 1º vencimento ${date(c.primeiro_vencimento)}</dd>
        <dt>Condições</dt><dd>${c.qtd_parcelas}x ${esc(U.LABELS.frequencia[c.frequencia])} · ${esc(U.LABELS.sistema[c.sistema_amortizacao])}</dd>
        <dt>Taxa</dt><dd>${U.pct(c.taxa_juros_mensal, 4)} a.m. (${U.pct(c.taxa_periodo, 4)} por período)</dd>
        <dt>Juros / encargos</dt><dd>${money(c.total_juros)} / ${money(c.encargos)}${c.descricao_encargos ? ' — ' + esc(c.descricao_encargos) : ''}</dd>
        <dt>CET</dt><dd>${c.cet_mensal === null ? '—' : `${U.pct(c.cet_mensal)} a.m. · ${U.pct(cetA)} a.a.`}</dd>
        ${c.contrato_origem_id ? `<dt>Origem</dt><dd><button type="button" class="btn btn-sm" data-open="${esc(c.contrato_origem_id)}">Ver contrato renegociado</button></dd>` : ''}
        ${c.motivo_status ? `<dt>Situação</dt><dd>${esc(c.motivo_status)}</dd>` : ''}
        ${c.observacoes ? `<dt>Observações</dt><dd>${esc(c.observacoes)}</dd>` : ''}
      </dl>
      <div class="section-title">Parcelas</div>
      ${pendente ? '<p class="muted">As parcelas serão geradas quando o cliente assinar. Veja os valores em "Notas promissórias".</p>' : ''}
      <div class="table-wrap ${pendente ? 'hidden' : ''}"><table class="table table-compact responsive"><thead><tr>
        <th>Nº</th><th>Vencimento</th><th class="num">Valor</th><th class="num">Principal</th><th class="num">Juros</th><th class="num">Encargos</th>
        <th class="num">Pago</th><th class="num">Saldo</th><th>Situação</th><th></th></tr></thead><tbody>
        ${parcelas.map((p) => `<tr class="${p.situacao === 'vencida' ? 'row-highlight-danger' : p.situacao === 'a_vencer' ? 'row-highlight-warning' : ''}">
          <td data-label="Nº">${p.numero}</td><td data-label="Vencimento">${date(p.vencimento)}${p.dias_atraso ? ` <span class="small text-danger">(${p.dias_atraso}d)</span>` : ''}</td>
          <td data-label="Valor" class="num">${money(p.valor_total)}</td><td data-label="Principal" class="num">${money(p.valor_principal)}</td>
          <td data-label="Juros" class="num">${money(p.valor_juros)}</td><td data-label="Encargos" class="num">${money(p.valor_encargos)}</td>
          <td data-label="Pago" class="num">${money(p.valor_pago)}</td><td data-label="Saldo" class="num">${money(p.saldo)}</td>
          <td data-label="Situação">${U.statusBadge('situacao', p.situacao)}${p.status === 'parcial' ? ' ' + U.badge('Parcial', 'warning') : ''}</td>
          <td class="actions">${canPay && ['aberta', 'parcial'].includes(p.status) ? `<button class="btn btn-sm btn-primary" data-pay="${esc(p.id)}">Receber</button>` : ''}</td></tr>`).join('')}
      </tbody></table></div>
      <div class="section-title">Pagamentos</div>
      ${pagamentos.length ? `<div class="table-wrap"><table class="table table-compact responsive"><thead><tr>
        <th>Recibo</th><th>Data</th><th>Parcela</th><th class="num">Valor</th><th>Forma</th><th>Status</th><th></th></tr></thead><tbody>
        ${pagamentos.map((g) => `<tr><td data-label="Recibo" class="mono">${g.numero_recibo}</td><td data-label="Data">${date(g.data_pagamento)}</td>
          <td data-label="Parcela">${g.parcela_numero}/${g.qtd_parcelas}</td><td data-label="Valor" class="num">${money(g.valor)}</td>
          <td data-label="Forma">${esc(U.LABELS.forma[g.forma])}</td><td data-label="Status">${U.statusBadge('pagamentoStatus', g.status)}</td>
          <td class="actions"><button class="btn btn-sm" data-receipt="${esc(g.id)}">Recibo</button></td></tr>`).join('')}
      </tbody></table></div>` : U.emptyHTML('Nenhum pagamento registrado')}`;

    // Rodapé com ações conforme papel e status.
    let footer = m.el.querySelector('.modal-footer');
    if (!footer) {
      footer = document.createElement('div');
      footer.className = 'modal-footer';
      m.el.querySelector('.modal-inner').appendChild(footer);
    }
    const podeCancelar = pendente ? Auth.can('contratos.write')
      : Auth.can('contratos.cancelar') && c.status === 'ativo' && !c.contrato_origem_id && Number(c.total_pago) === 0;
    footer.innerHTML = `
      ${podeCancelar ? '<button type="button" class="btn btn-danger" data-cancel>Cancelar contrato</button>' : ''}
      ${Auth.can('contratos.write') && c.status === 'ativo' ? '<button type="button" class="btn" data-reneg>Renegociar</button>' : ''}
      ${Auth.can('pagamentos.write') && c.status !== 'cancelado' ? '<button type="button" class="btn" data-notas>Notas promissórias</button>' : ''}
      ${assinatura && assinatura.status === 'assinado' ? '<button type="button" class="btn" data-ver-assinatura>Ver assinatura</button>' : ''}
      ${canPay && Number(c.saldo_aberto) > 0 ? '<button type="button" class="btn btn-success" data-quitar>Quitar contrato</button>' : ''}
      <button type="button" class="btn" data-print>${U.icon('printer')} Imprimir</button>
      ${pendente && Auth.can('contratos.write') ? '<button type="button" class="btn btn-whatsapp" data-enviar>Enviar para assinatura</button>' : ''}
      <button type="button" class="btn btn-primary" data-close>Fechar</button>`;
    const notas = footer.querySelector('[data-notas]');
    if (notas) notas.addEventListener('click', () => openNotas(c));
    const verAss = footer.querySelector('[data-ver-assinatura]');
    if (verAss) verAss.addEventListener('click', () => openAssinatura(c));
    const quitar = footer.querySelector('[data-quitar]');
    if (quitar) quitar.addEventListener('click', () => Pagamentos.openQuitacao(c, () => { refresh(); table.reload(); }));
    const enviar = footer.querySelector('[data-enviar]');
    if (enviar) enviar.addEventListener('click', () => openEnvio(c, refresh));

    m.body.querySelectorAll('[data-pay]').forEach((b) => b.addEventListener('click', () => {
      const p = parcelas.find((x) => x.id === b.dataset.pay);
      Pagamentos.openPaymentModal({ parcela: p, onDone: () => { refresh(); table.reload(); } });
    }));
    m.body.querySelectorAll('[data-receipt]').forEach((b) => b.addEventListener('click', () => Pagamentos.openReceipt(b.dataset.receipt)));
    const origin = m.body.querySelector('[data-open]');
    if (origin) origin.addEventListener('click', () => openDetail(origin.dataset.open));
    const cancel = footer.querySelector('[data-cancel]');
    if (cancel) cancel.addEventListener('click', () => cancelContract(c, () => { m.close(); table.reload(); }));
    const reneg = footer.querySelector('[data-reneg]');
    if (reneg) reneg.addEventListener('click', () => openRenegotiation(c, parcelas, (newId) => { m.close(); table.reload(); openDetail(newId); }));
    footer.querySelector('[data-print]').addEventListener('click', () => U.printModal());
  }

  // ------------------------------------------------------------------ renegociação
  function openRenegotiation(c, parcelas, onDone) {
    const abertas = parcelas.filter((p) => ['aberta', 'parcial'].includes(p.status));
    const saldoPrincipal = abertas.reduce((a, p) => a + F.toCents(p.valor_principal) - F.toCents(p.pago_principal), 0n);
    const saldoTotal = abertas.reduce((a, p) => a + F.toCents(p.saldo), 0n);
    const principalStr = F.centsToString(saldoPrincipal);
    const m = U.modal({
      title: `Renegociar contrato nº ${c.numero}`,
      size: 'xl',
      body: `${complianceAlert()}
        <div class="alert alert-info">O novo contrato terá como principal o <strong>saldo de principal em aberto (${money(saldoPrincipal)})</strong>.
          Juros e encargos não pagos (${money(saldoTotal - saldoPrincipal)}) não são capitalizados. As ${abertas.length} parcela(s) em aberto serão
          marcadas como renegociadas e o contrato atual ficará com status "Renegociado". Não há nova liberação de caixa.</div>
        <form id="form-reneg" novalidate>
          ${termsHTML({ principal: U.moneyInput(principalStr), principalLocked: true, extra: `
            <div class="field full"><label for="t-motivo">Motivo da renegociação <span class="req">*</span></label>
              <textarea id="t-motivo" name="motivo" maxlength="1000" placeholder="Descreva o motivo e o acordo com o cliente"></textarea>
              <span class="error-msg"></span></div>` })}
        </form>
        <div class="sim-out mt-2"></div>`,
      footer: `<button type="button" class="btn" data-close>Cancelar</button>
        <button type="button" class="btn" data-simulate>Simular</button>
        <button type="button" class="btn btn-primary" data-confirm disabled>Confirmar renegociação</button>`,
    });
    const form = m.el.querySelector('form');
    // Taxa atual como sugestão, sem perder casas decimais (fração 1e-8 → percentual 1e-6).
    form.taxa.value = F.formatScaled(F.parseDecimal(String(c.taxa_juros_mensal), 8), 6).replace(/\.?0+$/, '').replace('.', ',');
    simulationController(m, form, async (sim, btn) => {
      U.clearErrors(form);
      const motivo = form.motivo.value.trim();
      if (motivo.length < 10) { U.fieldError(form, 'motivo', 'Mínimo de 10 caracteres.'); form.motivo.focus(); return; }
      const ok = await U.confirm({
        title: 'Confirmar renegociação',
        html: true,
        message: `<p>Novo contrato: <strong>${money(saldoPrincipal)}</strong> em <strong>${sim.p.parcelas}x</strong> · total <strong>${money(sim.s.total)}</strong>.</p>
          <p class="small muted">Esta operação não pode ser desfeita.</p>`,
        confirmText: 'Renegociar',
      });
      if (!ok) return;
      U.busy(btn, true, 'Processando...');
      try {
        const newId = await U.rpc('renegociar_contrato', Object.assign({ p_contrato_id: c.id, p_motivo: motivo }, rpcTerms(sim)));
        U.toast('Renegociação registrada.', 'success');
        m.close();
        onDone(newId);
      } catch (err) {
        U.busy(btn, false);
        U.toast(U.errorMessage(err), 'error', 9000);
      }
    });
  }

  async function cancelContract(c, onDone) {
    const ok = await U.confirm({
      title: `Cancelar contrato nº ${c.numero}`,
      html: true,
      message: c.status === 'pendente_assinatura'
        ? `<div class="alert alert-danger">O contrato ainda não foi assinado. Ele será cancelado e o link de assinatura deixará de funcionar.
            Nada é lançado no caixa.</div>`
        : `<div class="alert alert-danger">O contrato e suas parcelas serão cancelados e a devolução de ${money(c.principal)} será lançada como entrada no caixa.
            Só é permitido quando não há pagamentos confirmados.</div>`,
      confirmText: 'Cancelar contrato',
      danger: true,
      reason: { label: 'Motivo do cancelamento', minLength: 10 },
    });
    if (!ok) return;
    try {
      await U.rpc('cancelar_contrato', { p_contrato_id: c.id, p_motivo: ok.reason });
      U.toast('Contrato cancelado.', 'success');
      onDone();
    } catch (err) { U.toast(U.errorMessage(err), 'error', 9000); }
  }

  // ------------------------------------------------------------------ página
  App.page('contratos', 'Contratos', async () => {
    const btnNovo = document.getElementById('btn-novo');
    btnNovo.innerHTML = `${U.icon('plus')} Novo contrato`;
    if (!Auth.can('contratos.write')) btnNovo.classList.add('hidden');
    btnNovo.addEventListener('click', () => openNew(null));

    table = new DataTable({
      container: document.getElementById('tbl-contratos'),
      searchPlaceholder: 'Buscar por cliente ou nº do contrato',
      filters: [{ key: 'status', label: 'Status', type: 'select', value: 'abertos', options: [
        { value: 'abertos', label: 'Ativos e aguardando assinatura' }, { value: 'pendente_assinatura', label: 'Aguardando assinatura' },
        { value: 'ativo', label: 'Ativos' }, { value: 'quitado', label: 'Quitados' }, { value: 'renegociado', label: 'Renegociados' },
        { value: 'cancelado', label: 'Cancelados' }, { value: '', label: 'Todos' }] }],
      emptyTitle: 'Nenhum contrato encontrado',
      columns: [
        { label: 'Nº', render: (r) => `<strong class="mono">${esc(r.numero)}</strong>` },
        { label: 'Cliente', render: (r) => esc(r.cliente_nome) },
        { label: 'Data', render: (r) => date(r.data_contratacao) },
        { label: 'Principal', className: 'num', render: (r) => money(r.principal) },
        { label: 'Parcelas', render: (r) => `${r.parcelas_pagas}/${r.qtd_parcelas} · ${money(r.valor_parcela)}` },
        { label: 'Taxa a.m.', className: 'num', render: (r) => U.pct(r.taxa_juros_mensal, 2) },
        { label: 'Saldo', className: 'num', render: (r) => money(r.saldo_aberto) },
        { label: 'Próx. venc.', render: (r) => date(r.proximo_vencimento) },
        { label: 'Status', render: (r) => U.statusBadge('contratoStatus', r.status) +
            (Number(r.parcelas_vencidas) ? ' ' + U.badge(`${r.parcelas_vencidas} vencida(s)`, 'danger') : '') },
        { label: 'Ações', className: 'actions', render: () => '<button class="btn btn-sm" data-action="open">Abrir</button>' },
      ],
      fetch: async ({ from, to, search, filters }) => {
        let q = Auth.client.from('vw_contratos')
          .select('id, numero, cliente_nome, data_contratacao, principal, parcelas_pagas, qtd_parcelas, valor_parcela, taxa_juros_mensal, saldo_aberto, proximo_vencimento, status, parcelas_vencidas', { count: 'exact' })
          .order('numero', { ascending: false }).range(from, to);
        if (filters.status === 'abertos') q = q.in('status', ['pendente_assinatura', 'ativo']);
        else if (filters.status) q = q.eq('status', filters.status);
        if (search) q = /^\d+$/.test(search) ? q.eq('numero', Number(search)) : q.ilike('cliente_nome', `%${search}%`);
        const { data, error, count } = await q;
        if (error) throw error;
        return { rows: data, total: count };
      },
      rowClass: (r) => (Number(r.parcelas_vencidas) ? 'row-highlight-danger' : ''),
      onAction: (action, row) => { if (action === 'open') openDetail(row.id); },
    });
    await table.load();

    const params = App.params;
    const uuid = /^[0-9a-f-]{36}$/i;
    if (params.get('contrato') && uuid.test(params.get('contrato'))) openDetail(params.get('contrato'));
    else if (Auth.can('contratos.write') && params.has('novo')) {
      const cli = params.get('novo');
      openNew(cli && uuid.test(cli) ? cli : null);
    }
  });

  window.Contratos = { openDetail };
})();

/* ==========================================================================
 * parcelas.js
 * ========================================================================== */
/*
 * parcelas.js — Consulta de vencimentos com alertas visuais, recebimento e exportação.
 */
(function () {
  'use strict';
  const { esc, money, date, int } = U;
  let table;

  function applyFilters(q, { search, filters }) {
    switch (filters.situacao) {
      case 'abertas': q = q.in('status', ['aberta', 'parcial']); break;
      case 'vencida': case 'a_vencer': case 'em_dia': q = q.eq('situacao', filters.situacao); break;
      case 'paga': q = q.eq('status', 'paga'); break;
      default: break;
    }
    if (filters.de) q = q.gte('vencimento', filters.de);
    if (filters.ate) q = q.lte('vencimento', filters.ate);
    if (search) q = /^\d+$/.test(search) ? q.eq('contrato_numero', Number(search)) : q.ilike('cliente_nome', `%${search}%`);
    return q;
  }

  async function loadKpis() {
    const el = document.getElementById('kpis');
    try {
      const d = await U.rpc('dashboard_resumo');
      el.innerHTML = `
        <div class="card kpi kpi-danger"><div class="kpi-label">Vencidas</div><div class="kpi-value">${int(d.vencidas_qtd)}</div><div class="kpi-sub">${money(d.vencidas_valor)}</div></div>
        <div class="card kpi kpi-warning"><div class="kpi-label">Vencem em ${d.dias_alerta} dias</div><div class="kpi-value">${int(d.a_vencer_qtd)}</div><div class="kpi-sub">${money(d.a_vencer_valor)}</div></div>
        <div class="card kpi"><div class="kpi-label">Saldo em aberto</div><div class="kpi-value">${money(d.saldo_aberto)}</div><div class="kpi-sub">principal ${money(d.saldo_principal)}</div></div>`;
    } catch (err) {
      el.innerHTML = `<div class="card">${U.errorHTML(U.errorMessage(err), false)}</div>`;
    }
  }

  async function exportCSV(btn) {
    U.busy(btn, true, 'Exportando...');
    try {
      const q = applyFilters(Auth.client.from('vw_parcelas').select('*').order('vencimento').limit(5000),
        { search: U.sanitizeSearch(table.search), filters: table.filters });
      const { data, error } = await q;
      if (error) throw error;
      if (!data.length) { U.toast('Nenhuma parcela para exportar com os filtros atuais.', 'warning'); return; }
      U.downloadCSV(`parcelas-${U.today()}.csv`,
        ['Contrato', 'Cliente', 'Parcela', 'Vencimento', 'Valor', 'Principal', 'Juros', 'Encargos', 'Pago', 'Saldo', 'Dias de atraso', 'Situação'],
        data.map((p) => [p.contrato_numero, p.cliente_nome, `${p.numero}/${p.qtd_parcelas}`, U.date(p.vencimento),
          U.csvNumber(p.valor_total), U.csvNumber(p.valor_principal), U.csvNumber(p.valor_juros), U.csvNumber(p.valor_encargos),
          U.csvNumber(p.valor_pago), U.csvNumber(p.saldo), p.dias_atraso, (U.LABELS.situacao[p.situacao] || [p.situacao])[0]]));
      if (data.length === 5000) U.toast('Exportação limitada a 5.000 linhas. Refine os filtros.', 'warning');
    } catch (err) {
      U.toast(U.errorMessage(err), 'error');
    } finally {
      U.busy(btn, false);
    }
  }

  App.page('parcelas', 'Parcelas', async () => {
    const btnCsv = document.getElementById('btn-csv');
    btnCsv.innerHTML = `${U.icon('download')} Exportar CSV`;
    btnCsv.addEventListener('click', () => exportCSV(btnCsv));

    const params = App.params;
    const situacaoInicial = ['abertas', 'vencida', 'a_vencer', 'em_dia', 'paga', ''].includes(params.get('situacao')) ? params.get('situacao') : 'abertas';

    table = new DataTable({
      container: document.getElementById('tbl-parcelas'),
      searchPlaceholder: 'Buscar por cliente ou nº do contrato',
      filters: [
        { key: 'situacao', label: 'Situação', type: 'select', value: situacaoInicial, options: [
          { value: 'abertas', label: 'Em aberto' }, { value: 'vencida', label: 'Vencidas' },
          { value: 'a_vencer', label: 'Vencem em breve' }, { value: 'em_dia', label: 'Em dia' },
          { value: 'paga', label: 'Pagas' }, { value: '', label: 'Todas' }] },
        { key: 'de', label: 'Vencimento a partir de', type: 'date', value: '' },
        { key: 'ate', label: 'Vencimento até', type: 'date', value: '' },
      ],
      emptyTitle: 'Nenhuma parcela encontrada',
      emptyText: 'Ajuste os filtros para ver outras parcelas.',
      columns: [
        { label: 'Contrato', render: (r) => `<a href="#contratos?contrato=${encodeURIComponent(r.contrato_id)}" class="mono">${esc(r.contrato_numero)}</a>` },
        { label: 'Cliente', render: (r) => esc(r.cliente_nome) },
        { label: 'Parcela', render: (r) => `${r.numero}/${r.qtd_parcelas}` },
        { label: 'Vencimento', render: (r) => `${date(r.vencimento)}${r.dias_atraso ? `<div class="small text-danger">${r.dias_atraso} dia(s) de atraso</div>` : ''}` },
        { label: 'Valor', className: 'num', render: (r) => money(r.valor_total) },
        { label: 'Pago', className: 'num', render: (r) => money(r.valor_pago) },
        { label: 'Saldo', className: 'num', render: (r) => `<strong>${money(r.saldo)}</strong>` },
        { label: 'Situação', render: (r) => U.statusBadge('situacao', r.situacao) + (r.status === 'parcial' ? ' ' + U.badge('Parcial', 'warning') : '') },
        { label: 'Ações', className: 'actions', render: (r) =>
            Auth.can('pagamentos.write') && ['aberta', 'parcial'].includes(r.status) && r.contrato_status === 'ativo'
              ? '<button class="btn btn-sm btn-primary" data-action="pay">Receber</button>' : '' },
      ],
      fetch: async (opts) => {
        const q = applyFilters(Auth.client.from('vw_parcelas').select('*', { count: 'exact' })
          .order('vencimento').order('contrato_numero').range(opts.from, opts.to), opts);
        const { data, error, count } = await q;
        if (error) throw error;
        return { rows: data, total: count };
      },
      rowClass: (r) => (r.situacao === 'vencida' ? 'row-highlight-danger' : r.situacao === 'a_vencer' ? 'row-highlight-warning' : ''),
      onAction: (action, row) => {
        if (action === 'pay') Pagamentos.openPaymentModal({ parcela: row, onDone: () => { table.reload(); loadKpis(); } });
      },
    });
    await Promise.all([table.load(), loadKpis()]);
  });
})();

/* ==========================================================================
 * fluxo-caixa.js
 * ========================================================================== */
/*
 * fluxo-caixa.js — Entradas, saídas, previsões e saldo.
 * Liberações, recebimentos e estornos são lançados automaticamente pelo banco
 * (uma única vez por pagamento/contrato). Aqui o usuário lança apenas despesas,
 * aportes, retiradas e outros valores — previstos ou realizados.
 */
(function () {
  'use strict';
  const { esc, money, date } = U;
  const F = window.Finance;
  const MANUAL = { entrada: ['aporte', 'outras_entradas'], saida: ['despesa_operacional', 'retirada', 'outras_saidas'] };
  let periodo = { de: '', ate: '' };
  let table;

  function setRange(kind) {
    const today = U.today();
    if (kind === 'mes') periodo = { de: U.monthStart(today), ate: U.monthEnd(today) };
    else if (kind === '90') periodo = { de: today, ate: F.addDays(today, 90) };
    else if (kind === 'ano') periodo = { de: today.slice(0, 4) + '-01-01', ate: today.slice(0, 4) + '-12-31' };
    const form = document.getElementById('form-periodo');
    form.de.value = periodo.de;
    form.ate.value = periodo.ate;
  }

  function kpi(label, value, sub, variant = '') {
    return `<div class="card kpi ${variant ? 'kpi-' + variant : ''}"><div class="kpi-label">${esc(label)}</div>
      <div class="kpi-value">${value}</div>${sub ? `<div class="kpi-sub">${sub}</div>` : ''}</div>`;
  }

  async function loadSummary() {
    const kpis = document.getElementById('kpis');
    const byCat = document.getElementById('by-cat');
    kpis.innerHTML = `<div class="card">${U.loadingHTML()}</div>`;
    byCat.innerHTML = U.loadingHTML();
    try {
      const r = await U.rpc('resumo_caixa', { p_inicio: periodo.de, p_fim: periodo.ate });
      const cats = r.por_categoria || [];
      const ent = cats.filter((c) => c.tipo === 'entrada').reduce((a, c) => a + Number(c.total), 0);
      const sai = cats.filter((c) => c.tipo === 'saida').reduce((a, c) => a + Number(c.total), 0);
      const ini = Number(r.saldo_inicial);
      const fim = ini + ent - sai;
      const prevEnt = Number(r.previsto_parcelas) + Number(r.previsto_manual_entradas);
      const prevSai = Number(r.previsto_manual_saidas);
      kpis.innerHTML = [
        kpi('Saldo inicial', money(ini), `em ${date(periodo.de)}`),
        kpi('Entradas realizadas', money(ent), 'recebimentos, aportes e outras', 'success'),
        kpi('Saídas realizadas', money(sai), 'liberações, despesas, estornos', 'danger'),
        kpi('Saldo realizado', money(fim), `em ${date(periodo.ate)}`, fim < 0 ? 'danger' : 'accent'),
        kpi('Entradas previstas', money(prevEnt), `parcelas a vencer ${money(r.previsto_parcelas)}`, 'warning'),
        kpi('Saldo projetado', money(fim + prevEnt - prevSai), `saídas previstas ${money(prevSai)}`),
        kpi('Vencido em aberto', money(r.vencido_em_aberto), 'não incluído na projeção', Number(r.vencido_em_aberto) ? 'danger' : ''),
      ].join('');

      byCat.innerHTML = cats.length ? `<ul class="list">${cats.map((c) => `<li>
          <div><div class="primary-text">${esc(U.LABELS.categoria[c.categoria] || c.categoria)}</div><div class="secondary-text">${c.qtd} lançamento(s)</div></div>
          <div class="primary-text ${c.tipo === 'entrada' ? 'text-success' : 'text-danger'}">${c.tipo === 'entrada' ? '+' : '−'} ${money(c.total)}</div></li>`).join('')}</ul>`
        : U.emptyHTML('Sem lançamentos realizados no período');

      renderChart(r, ini);
    } catch (err) {
      kpis.innerHTML = `<div class="card span-2">${U.errorHTML(U.errorMessage(err), false)}</div>`;
      byCat.innerHTML = '';
    }
  }

  function renderChart(r, saldoInicial) {
    const days = F.diffDays(periodo.de, periodo.ate);
    const monthly = days > 62;
    const keyOf = (d) => (monthly ? d.slice(0, 7) : d);
    const buckets = new Map();
    let d = periodo.de;
    while (d <= periodo.ate) {
      const k = keyOf(d);
      if (!buckets.has(k)) buckets.set(k, { ent: 0, sai: 0, pEnt: 0, pSai: 0 });
      d = monthly ? F.addMonths(U.monthStart(d), 1) : F.addDays(d, 1);
    }
    (r.serie_diaria || []).forEach((x) => {
      const b = buckets.get(keyOf(x.data));
      if (!b) return;
      b.ent += Number(x.entradas); b.sai += Number(x.saidas);
      b.pEnt += Number(x.entradas_previstas); b.pSai += Number(x.saidas_previstas);
    });
    (r.previsto_parcelas_serie || []).forEach((x) => { const b = buckets.get(keyOf(x.data)); if (b) b.pEnt += Number(x.valor); });
    const keys = [...buckets.keys()];
    let acc = saldoInicial;
    const saldo = keys.map((k) => { const b = buckets.get(k); acc += b.ent - b.sai; return acc; });
    document.getElementById('chart-legend').textContent = monthly ? 'agrupado por mês' : 'agrupado por dia';
    U.chart(document.getElementById('chart-caixa'), {
      data: {
        labels: keys.map((k) => (monthly ? U.monthLabel(k) : U.date(k).slice(0, 5))),
        datasets: [
          { type: 'bar', label: 'Entradas', data: keys.map((k) => buckets.get(k).ent), backgroundColor: U.COLORS.success, stack: 'r' },
          { type: 'bar', label: 'Saídas', data: keys.map((k) => -buckets.get(k).sai), backgroundColor: U.COLORS.danger, stack: 'r' },
          { type: 'bar', label: 'Entradas previstas', data: keys.map((k) => buckets.get(k).pEnt), backgroundColor: 'rgba(26,127,75,.28)', stack: 'p' },
          { type: 'bar', label: 'Saídas previstas', data: keys.map((k) => -buckets.get(k).pSai), backgroundColor: 'rgba(180,35,24,.25)', stack: 'p' },
          { type: 'line', label: 'Saldo realizado', data: saldo, borderColor: U.COLORS.primary, backgroundColor: U.COLORS.primary, tension: .2, pointRadius: 0, yAxisID: 'saldo' },
        ],
      },
      options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
                 plugins: { legend: { position: 'bottom' },
                            tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${c.dataset.yAxisID === 'saldo' ? money(c.parsed.y) : money(Math.abs(c.parsed.y))}` } } },
                 scales: { x: { stacked: true }, y: { stacked: true, ticks: U.chartMoneyTicks },
                           saldo: { position: 'right', grid: { drawOnChartArea: false }, ticks: U.chartMoneyTicks } } },
    });
  }

  function openForm(row) {
    const edit = !!row;
    const tipo0 = row ? row.tipo : 'saida';
    const m = U.modal({
      title: edit ? 'Editar lançamento' : 'Novo lançamento manual',
      body: `<form id="form-mov" novalidate><div class="form-grid">
          <div class="field"><label for="mv-tipo">Tipo <span class="req">*</span></label>
            <select id="mv-tipo" name="tipo">${U.options({ entrada: 'Entrada', saida: 'Saída' }, tipo0)}</select></div>
          <div class="field"><label for="mv-cat">Categoria <span class="req">*</span></label><select id="mv-cat" name="categoria"></select></div>
          <div class="field"><label for="mv-valor">Valor (R$) <span class="req">*</span></label>
            <input type="text" id="mv-valor" name="valor" inputmode="decimal" value="${esc(row ? U.moneyInput(row.valor) : '')}"><span class="error-msg"></span></div>
          <div class="field"><label for="mv-data">Data <span class="req">*</span></label>
            <input type="date" id="mv-data" name="data" value="${esc(row ? row.data : U.today())}"><span class="error-msg"></span></div>
          <div class="field"><label for="mv-sit">Situação <span class="req">*</span></label>
            <select id="mv-sit" name="situacao">${U.options({ realizado: 'Realizado', previsto: 'Previsto' }, row ? row.situacao : 'realizado')}</select>
            <span class="hint">Previstos entram apenas na projeção.</span></div>
          <div class="field full"><label for="mv-desc">Descrição <span class="req">*</span></label>
            <input type="text" id="mv-desc" name="descricao" maxlength="500" value="${esc(row ? row.descricao || '' : '')}"><span class="error-msg"></span></div>
        </div></form>
        <p class="small muted">Liberações de crédito e recebimentos são lançados automaticamente pelos contratos e pagamentos —
          não os registre aqui, para evitar contabilização duplicada.</p>`,
      footer: `<button type="button" class="btn" data-close>Cancelar</button><button type="submit" form="form-mov" class="btn btn-primary">Salvar</button>`,
    });
    const form = m.el.querySelector('form');
    const fillCats = () => {
      const cats = MANUAL[form.tipo.value];
      form.categoria.innerHTML = cats.map((c) => `<option value="${c}"${row && row.categoria === c ? ' selected' : ''}>${esc(U.LABELS.categoria[c])}</option>`).join('');
    };
    fillCats();
    form.tipo.addEventListener('change', fillCats);
    form.valor.addEventListener('blur', () => { const v = U.parseMoney(form.valor.value); if (v) form.valor.value = U.moneyInput(v); });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      U.clearErrors(form);
      const valor = U.parseMoney(form.valor.value);
      const descricao = form.descricao.value.trim();
      let ok = true;
      if (!valor || F.toCents(valor) <= 0n) { U.fieldError(form, 'valor', 'Informe um valor maior que zero.'); ok = false; }
      if (!form.data.value) { U.fieldError(form, 'data', 'Informe a data.'); ok = false; }
      if (descricao.length < 3) { U.fieldError(form, 'descricao', 'Descreva o lançamento.'); ok = false; }
      if (form.situacao.value === 'realizado' && form.data.value > U.today()) {
        U.fieldError(form, 'data', 'Lançamento realizado não pode ter data futura. Use "Previsto".'); ok = false;
      }
      if (!ok) { U.focusFirstError(form); return; }
      const payload = { tipo: form.tipo.value, categoria: form.categoria.value, valor, data: form.data.value,
                        descricao, situacao: form.situacao.value };
      const btn = m.el.querySelector('button[type=submit]');
      U.busy(btn, true, 'Salvando...');
      try {
        if (edit) {
          const { data, error } = await Auth.client.from('movimentacoes_caixa').update(payload).eq('id', row.id).select('id');
          if (error) throw error;
          if (!data.length) throw new Error('Lançamento não encontrado ou sem permissão para alterá-lo.');
        } else {
          const { error } = await Auth.client.from('movimentacoes_caixa').insert(Object.assign({ id: crypto.randomUUID() }, payload));
          if (error) throw error;
        }
        U.toast('Lançamento salvo.', 'success');
        m.close();
        refresh();
      } catch (err) {
        U.busy(btn, false);
        U.toast(U.errorMessage(err), 'error');
      }
    });
  }

  async function setSituacao(row, situacao) {
    const cancel = situacao === 'cancelado';
    if (!cancel && row.data > U.today()) { U.toast('Ajuste a data para hoje ou anterior antes de marcar como realizado (use Editar).', 'warning'); return; }
    const ok = await U.confirm({
      title: cancel ? 'Cancelar lançamento' : 'Marcar como realizado',
      message: cancel ? `Cancelar "${row.descricao}" (${money(row.valor)})? O registro é mantido, mas deixa de compor o caixa.`
                      : `Confirmar que "${row.descricao}" (${money(row.valor)}) foi efetivamente realizado em ${date(row.data)}?`,
      confirmText: cancel ? 'Cancelar lançamento' : 'Confirmar',
      danger: cancel,
    });
    if (!ok) return;
    try {
      const { data, error } = await Auth.client.from('movimentacoes_caixa').update({ situacao }).eq('id', row.id).select('id');
      if (error) throw error;
      if (!data.length) throw new Error('Lançamento não encontrado ou sem permissão.');
      U.toast('Lançamento atualizado.', 'success');
      refresh();
    } catch (err) { U.toast(U.errorMessage(err), 'error'); }
  }

  function refresh() {
    loadSummary();
    table.reload();
  }

  App.page('fluxo-caixa', 'Fluxo de caixa', async () => {
    const btnNovo = document.getElementById('btn-novo');
    btnNovo.innerHTML = `${U.icon('plus')} Novo lançamento`;
    const canWrite = Auth.can('caixa.write');
    if (!canWrite) btnNovo.classList.add('hidden');
    btnNovo.addEventListener('click', () => openForm(null));

    setRange('mes');
    const form = document.getElementById('form-periodo');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!form.de.value || !form.ate.value || form.ate.value < form.de.value) { U.toast('Período inválido.', 'error'); return; }
      if (F.diffDays(form.de.value, form.ate.value) > 1830) { U.toast('Período máximo de 5 anos.', 'error'); return; }
      periodo = { de: form.de.value, ate: form.ate.value };
      refresh();
    });
    form.querySelectorAll('[data-range]').forEach((b) => b.addEventListener('click', () => { setRange(b.dataset.range); refresh(); }));

    table = new DataTable({
      container: document.getElementById('tbl-mov'),
      searchPlaceholder: 'Buscar na descrição',
      filters: [
        { key: 'tipo', label: 'Tipo', type: 'select', value: '', options: [{ value: '', label: 'Entradas e saídas' }, { value: 'entrada', label: 'Entradas' }, { value: 'saida', label: 'Saídas' }] },
        { key: 'situacao', label: 'Situação', type: 'select', value: '', options: [{ value: '', label: 'Todas as situações' }, { value: 'realizado', label: 'Realizados' }, { value: 'previsto', label: 'Previstos' }, { value: 'cancelado', label: 'Cancelados' }] },
        { key: 'origem', label: 'Origem', type: 'select', value: '', options: [{ value: '', label: 'Todas as origens' }, ...Object.entries(U.LABELS.origem).map(([value, label]) => ({ value, label }))] },
      ],
      emptyTitle: 'Nenhum lançamento no período',
      columns: [
        { label: 'Data', render: (r) => date(r.data) },
        { label: 'Categoria', render: (r) => esc(U.LABELS.categoria[r.categoria] || r.categoria) },
        { label: 'Descrição', render: (r) => esc(r.descricao || '—') },
        { label: 'Valor', className: 'num', render: (r) => `<strong class="${r.tipo === 'entrada' ? 'text-success' : 'text-danger'}">${r.tipo === 'entrada' ? '+' : '−'} ${money(r.valor)}</strong>` },
        { label: 'Situação', render: (r) => U.statusBadge('movSituacao', r.situacao) },
        { label: 'Origem', render: (r) => U.badge(U.LABELS.origem[r.origem] || r.origem, r.origem === 'manual' ? 'neutral' : 'info') },
        { label: 'Ações', className: 'actions', render: (r) => (canWrite && r.origem === 'manual' && r.situacao !== 'cancelado') ? `<div class="btn-group">
            <button class="btn btn-sm" data-action="edit">Editar</button>
            ${r.situacao === 'previsto' ? '<button class="btn btn-sm" data-action="realize">Realizado</button>' : ''}
            <button class="btn btn-sm btn-danger" data-action="cancel">Cancelar</button></div>` : '' },
      ],
      fetch: async ({ from, to, search, filters }) => {
        let q = Auth.client.from('movimentacoes_caixa').select('*', { count: 'exact' })
          .gte('data', periodo.de).lte('data', periodo.ate)
          .order('data', { ascending: false }).order('created_at', { ascending: false }).range(from, to);
        if (filters.tipo) q = q.eq('tipo', filters.tipo);
        if (filters.situacao) q = q.eq('situacao', filters.situacao);
        if (filters.origem) q = q.eq('origem', filters.origem);
        if (search) q = q.ilike('descricao', `%${search}%`);
        const { data, error, count } = await q;
        if (error) throw error;
        return { rows: data, total: count };
      },
      onAction: (action, row) => {
        if (action === 'edit') openForm(row);
        else if (action === 'realize') setSituacao(row, 'realizado');
        else if (action === 'cancel') setSituacao(row, 'cancelado');
      },
    });
    await Promise.all([loadSummary(), table.load()]);
  });
})();

/* ==========================================================================
 * relatorios.js
 * ========================================================================== */
/*
 * relatorios.js — Relatórios gerados por funções SQL (respeitam RLS) com gráficos e CSV.
 */
(function () {
  'use strict';
  const { esc, money, int } = U;
  const F = window.Finance;
  const cache = {};
  const loaded = {};

  const kpi = (label, value, sub, variant = '') => `<div class="card kpi ${variant ? 'kpi-' + variant : ''}">
    <div class="kpi-label">${esc(label)}</div><div class="kpi-value">${value}</div>${sub ? `<div class="kpi-sub">${sub}</div>` : ''}</div>`;

  function tableHTML(headers, rows, foot) {
    return `<div class="table-wrap"><table class="table table-compact responsive"><thead><tr>${headers.map((h) =>
      `<th class="${h.num ? 'num' : ''}">${esc(h.label)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) =>
      `<tr>${r.map((c, i) => `<td data-label="${esc(headers[i].label)}" class="${headers[i].num ? 'num' : ''}">${c}</td>`).join('')}</tr>`).join('')}</tbody>
      ${foot ? `<tfoot><tr>${foot.map((c, i) => `<td class="${headers[i].num ? 'num' : ''}">${c}</td>`).join('')}</tr></tfoot>` : ''}</table></div>`;
  }

  // ------------------------------------------------------------------ recebimentos
  async function loadRecebimentos() {
    const form = document.getElementById('form-rec');
    const de = form.de.value;
    const ate = form.ate.value;
    if (!de || !ate || ate < de) { U.toast('Período inválido.', 'error'); return; }
    if (F.diffDays(de, ate) > 1830) { U.toast('Período máximo de 5 anos.', 'error'); return; }
    const kp = document.getElementById('rec-kpis');
    kp.innerHTML = `<div class="card">${U.loadingHTML()}</div>`;
    document.getElementById('rec-table').innerHTML = U.loadingHTML();
    document.getElementById('rec-forma').innerHTML = U.loadingHTML();
    try {
      const r = await U.rpc('relatorio_recebimentos', { p_inicio: de, p_fim: ate });
      cache.rec = Object.assign({ de, ate }, r);
      const t = r.totais;
      kp.innerHTML = [
        kpi('Total recebido', money(t.total), `${int(t.qtd)} pagamento(s)`, 'success'),
        kpi('Principal', money(t.principal), 'amortização recebida'),
        kpi('Juros', money(t.juros), 'receita de juros', 'accent'),
        kpi('Encargos', money(t.encargos), 'encargos recebidos'),
        kpi('Estornos', money(t.total_estornado), `${int(t.qtd_estornos)} estorno(s) no período`, Number(t.qtd_estornos) ? 'danger' : ''),
      ].join('');

      const meses = r.por_mes || [];
      U.chart(document.getElementById('chart-rec'), {
        type: 'bar',
        data: { labels: meses.map((m) => U.monthLabel(m.mes)), datasets: [
          { label: 'Principal', data: meses.map((m) => Number(m.principal)), backgroundColor: U.COLORS.primary },
          { label: 'Juros', data: meses.map((m) => Number(m.juros)), backgroundColor: U.COLORS.accent },
          { label: 'Encargos', data: meses.map((m) => Number(m.encargos)), backgroundColor: U.COLORS.warning }] },
        options: { maintainAspectRatio: false, plugins: { legend: { position: 'bottom' }, tooltip: U.chartMoneyTooltip },
                   scales: { x: { stacked: true }, y: { stacked: true, ticks: U.chartMoneyTicks } } },
      });

      document.getElementById('rec-table').innerHTML = meses.length ? tableHTML(
        [{ label: 'Mês' }, { label: 'Pagamentos', num: true }, { label: 'Principal', num: true }, { label: 'Juros', num: true }, { label: 'Encargos', num: true }, { label: 'Total', num: true }],
        meses.map((m) => [esc(U.monthLabel(m.mes)), int(m.qtd), money(m.principal), money(m.juros), money(m.encargos), `<strong>${money(m.total)}</strong>`]),
        ['Total', int(t.qtd), money(t.principal), money(t.juros), money(t.encargos), money(t.total)],
      ) : U.emptyHTML('Nenhum recebimento no período');

      const formas = r.por_forma || [];
      document.getElementById('rec-forma').innerHTML = formas.length ? `<ul class="list">${formas.map((f) => `<li>
          <div><div class="primary-text">${esc(U.LABELS.forma[f.forma] || f.forma)}</div><div class="secondary-text">${int(f.qtd)} pagamento(s)</div></div>
          <div class="primary-text">${money(f.total)}</div></li>`).join('')}</ul>` : U.emptyHTML('Sem dados');
    } catch (err) {
      kp.innerHTML = `<div class="card span-2">${U.errorHTML(U.errorMessage(err), false)}</div>`;
      document.getElementById('rec-table').innerHTML = '';
      document.getElementById('rec-forma').innerHTML = '';
    }
  }

  // ------------------------------------------------------------------ inadimplência
  async function loadInadimplencia() {
    const kp = document.getElementById('ina-kpis');
    kp.innerHTML = `<div class="card">${U.loadingHTML()}</div>`;
    document.getElementById('ina-table').innerHTML = U.loadingHTML();
    try {
      const r = await U.rpc('relatorio_inadimplencia');
      cache.ina = r;
      const f = r.faixas;
      const taxa = Number(r.total_devido_vencido) > 0 ? Number(f.total) / Number(r.total_devido_vencido) : 0;
      kp.innerHTML = [
        kpi('Total em atraso', money(f.total), `${int(f.qtd)} parcela(s)`, 'danger'),
        kpi('Taxa de inadimplência', U.pct(taxa), 'em atraso ÷ total já vencido', taxa > 0.1 ? 'danger' : 'warning'),
        kpi('Clientes em atraso', int((r.por_cliente || []).length), ''),
        kpi('Acima de 90 dias', money(f.d90_mais), 'maior risco de perda', Number(f.d90_mais) ? 'danger' : ''),
      ].join('');
      U.chart(document.getElementById('chart-aging'), {
        type: 'bar',
        data: { labels: ['1–30 dias', '31–60 dias', '61–90 dias', '> 90 dias'], datasets: [{ label: 'Em atraso',
          data: [f.d1_30, f.d31_60, f.d61_90, f.d90_mais].map(Number),
          backgroundColor: [U.COLORS.warning, '#d9731c', U.COLORS.danger, '#7f1d1d'] }] },
        options: { maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: U.chartMoneyTooltip }, scales: { y: { ticks: U.chartMoneyTicks } } },
      });
      const cli = r.por_cliente || [];
      document.getElementById('ina-table').innerHTML = cli.length ? tableHTML(
        [{ label: 'Cliente' }, { label: 'Contratos', num: true }, { label: 'Parcelas', num: true }, { label: 'Maior atraso', num: true }, { label: 'Valor em atraso', num: true }],
        cli.map((c) => [esc(c.cliente_nome), int(c.contratos), int(c.parcelas), `${int(c.maior_atraso)} dias`, `<strong>${money(c.total)}</strong>`]),
      ) : U.emptyHTML('Nenhum cliente em atraso', 'Ótimo! Não há parcelas vencidas em aberto.');
    } catch (err) {
      kp.innerHTML = `<div class="card span-2">${U.errorHTML(U.errorMessage(err), false)}</div>`;
      document.getElementById('ina-table').innerHTML = '';
    }
  }

  // ------------------------------------------------------------------ carteira
  async function loadCarteira() {
    ['cart-status', 'cart-sistema', 'proj-table'].forEach((id) => { document.getElementById(id).innerHTML = U.loadingHTML(); });
    try {
      const r = await U.rpc('relatorio_carteira');
      cache.cart = r;
      const st = r.por_status || [];
      const colors = { ativo: U.COLORS.info, quitado: U.COLORS.success, renegociado: U.COLORS.warning, cancelado: U.COLORS.muted };
      U.chart(document.getElementById('chart-status'), {
        type: 'doughnut',
        data: { labels: st.map((s) => U.LABELS.contratoStatus[s.status][0]),
                datasets: [{ data: st.map((s) => Number(s.qtd)), backgroundColor: st.map((s) => colors[s.status]) }] },
        options: { maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } },
      });
      document.getElementById('cart-status').innerHTML = st.length ? tableHTML(
        [{ label: 'Status' }, { label: 'Contratos', num: true }, { label: 'Principal', num: true }, { label: 'Total projetado', num: true }],
        st.map((s) => [U.statusBadge('contratoStatus', s.status), int(s.qtd), money(s.principal), money(s.total)]),
      ) : U.emptyHTML('Nenhum contrato');
      const si = r.por_sistema || [];
      document.getElementById('cart-sistema').innerHTML = si.length ? tableHTML(
        [{ label: 'Sistema' }, { label: 'Frequência' }, { label: 'Contratos', num: true }, { label: 'Principal', num: true }, { label: 'Taxa média a.m.', num: true }],
        si.map((s) => [esc(s.sistema), esc(U.LABELS.frequencia[s.frequencia]), int(s.qtd), money(s.principal), U.pct(s.taxa_media, 2)]),
      ) : U.emptyHTML('Nenhum contrato ativo');

      const pj = r.projecao || [];
      U.chart(document.getElementById('chart-proj'), {
        type: 'bar',
        data: { labels: pj.map((p) => U.monthLabel(p.mes)), datasets: [
          { label: 'Principal', data: pj.map((p) => Number(p.principal)), backgroundColor: U.COLORS.primary },
          { label: 'Juros', data: pj.map((p) => Number(p.juros)), backgroundColor: U.COLORS.accent },
          { label: 'Encargos', data: pj.map((p) => Number(p.encargos)), backgroundColor: U.COLORS.warning }] },
        options: { maintainAspectRatio: false, plugins: { legend: { position: 'bottom' }, tooltip: U.chartMoneyTooltip },
                   scales: { x: { stacked: true }, y: { stacked: true, ticks: U.chartMoneyTicks } } },
      });
      const sum = (k) => pj.reduce((a, p) => a + Number(p[k]), 0);
      document.getElementById('proj-table').innerHTML = pj.length ? tableHTML(
        [{ label: 'Mês' }, { label: 'Parcelas', num: true }, { label: 'Principal', num: true }, { label: 'Juros', num: true }, { label: 'Encargos', num: true }, { label: 'Total', num: true }],
        pj.map((p) => [esc(U.monthLabel(p.mes)), int(p.parcelas), money(p.principal), money(p.juros), money(p.encargos), `<strong>${money(p.total)}</strong>`]),
        ['Total', int(sum('parcelas')), money(sum('principal')), money(sum('juros')), money(sum('encargos')), money(sum('total'))],
      ) : U.emptyHTML('Nenhuma parcela a vencer nos próximos 12 meses');
    } catch (err) {
      document.getElementById('cart-status').innerHTML = U.errorHTML(U.errorMessage(err), false);
      document.getElementById('cart-sistema').innerHTML = '';
      document.getElementById('proj-table').innerHTML = '';
    }
  }

  const LOADERS = { recebimentos: loadRecebimentos, inadimplencia: loadInadimplencia, carteira: loadCarteira };

  function showTab(name) {
    document.querySelectorAll('.tab').forEach((t) => {
      const on = t.dataset.tab === name;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    document.querySelectorAll('[data-panel]').forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== name));
    if (!loaded[name]) { loaded[name] = true; LOADERS[name](); }
  }

  App.page('relatorios', 'Relatórios', async () => {
    Object.keys(loaded).forEach((k) => delete loaded[k]);
    Object.keys(cache).forEach((k) => delete cache[k]);
    const today = U.today();
    const form = document.getElementById('form-rec');
    form.de.value = F.addMonths(U.monthStart(today), -11);
    form.ate.value = today;
    form.addEventListener('submit', (e) => { e.preventDefault(); loadRecebimentos(); });

    const csvLabel = `${U.icon('download')} CSV`;
    ['rec-csv', 'ina-csv', 'proj-csv'].forEach((id) => { document.getElementById(id).innerHTML = csvLabel; });
    document.getElementById('btn-print').innerHTML = `${U.icon('printer')} Imprimir`;
    document.getElementById('btn-print').addEventListener('click', () => window.print());

    document.getElementById('rec-csv').addEventListener('click', () => {
      if (!cache.rec || !(cache.rec.por_mes || []).length) { U.toast('Gere o relatório com dados antes de exportar.', 'warning'); return; }
      U.downloadCSV(`recebimentos-${cache.rec.de}-a-${cache.rec.ate}.csv`, ['Mês', 'Pagamentos', 'Principal', 'Juros', 'Encargos', 'Total'],
        cache.rec.por_mes.map((m) => [m.mes, m.qtd, U.csvNumber(m.principal), U.csvNumber(m.juros), U.csvNumber(m.encargos), U.csvNumber(m.total)]));
    });
    document.getElementById('ina-csv').addEventListener('click', () => {
      if (!cache.ina || !(cache.ina.por_cliente || []).length) { U.toast('Não há dados para exportar.', 'warning'); return; }
      U.downloadCSV(`inadimplencia-${today}.csv`, ['Cliente', 'Contratos', 'Parcelas', 'Maior atraso (dias)', 'Valor em atraso'],
        cache.ina.por_cliente.map((c) => [c.cliente_nome, c.contratos, c.parcelas, c.maior_atraso, U.csvNumber(c.total)]));
    });
    document.getElementById('proj-csv').addEventListener('click', () => {
      if (!cache.cart || !(cache.cart.projecao || []).length) { U.toast('Não há dados para exportar.', 'warning'); return; }
      U.downloadCSV(`projecao-${today}.csv`, ['Mês', 'Parcelas', 'Principal', 'Juros', 'Encargos', 'Total'],
        cache.cart.projecao.map((p) => [p.mes, p.parcelas, U.csvNumber(p.principal), U.csvNumber(p.juros), U.csvNumber(p.encargos), U.csvNumber(p.total)]));
    });

    document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));
    showTab('recebimentos');
  });
})();

/* ==========================================================================
 * configuracoes.js
 * ========================================================================== */
/*
 * configuracoes.js — Organização, conformidade jurídica, usuários/papéis, perfil, senha e auditoria.
 */
(function () {
  'use strict';
  const { esc } = U;
  const F = window.Finance;
  let profilesById = {};

  function percentFromFraction(v) {
    if (v === null || v === undefined) return '';
    return F.formatScaled(F.parseDecimal(String(v), 8), 6).replace(/\.?0+$/, '').replace('.', ',');
  }

  function fillOrg() {
    const o = Auth.org;
    const f = document.getElementById('form-org');
    f.nome.value = o.nome;
    f.cnpj.value = o.cnpj ? U.formatCNPJ(o.cnpj) : '';
    f.dias_alerta.value = o.dias_alerta_vencimento;
    f.praca_pagamento.value = o.praca_pagamento || '';
    const c = document.getElementById('form-compliance');
    c.taxa.value = percentFromFraction(o.taxa_juros_max_mensal);
    c.data.value = o.enquadramento_data || '';
    c.responsavel.value = o.enquadramento_responsavel || '';
    c.observacoes.value = o.enquadramento_observacoes || '';
    c.validado.checked = !!o.enquadramento_validado;
    document.getElementById('compliance-badge').innerHTML = o.taxa_juros_max_mensal !== null && o.taxa_juros_max_mensal !== undefined
      ? U.badge(`Limite: ${U.pct(o.taxa_juros_max_mensal, 2)} a.m.`, 'info') : U.badge('Sem limite de taxa', 'neutral');
  }

  async function updateOrg(payload) {
    const { data, error } = await Auth.client.from('organizacoes').update(payload).eq('id', Auth.org.id).select('*');
    if (error) throw error;
    if (!data.length) throw new Error('Sem permissão para alterar a organização.');
    Auth.org = data[0];
    fillOrg();
  }

  function bindOrgForms() {
    const f = document.getElementById('form-org');
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      U.clearErrors(f);
      const nome = f.nome.value.trim();
      const cnpj = U.digits(f.cnpj.value);
      const dias = Number(f.dias_alerta.value);
      let ok = true;
      if (nome.length < 2) { U.fieldError(f, 'nome', 'Informe o nome.'); ok = false; }
      if (cnpj && cnpj.length !== 14) { U.fieldError(f, 'cnpj', 'CNPJ deve ter 14 dígitos.'); ok = false; }
      if (!Number.isInteger(dias) || dias < 1 || dias > 60) { U.fieldError(f, 'dias_alerta', 'Entre 1 e 60.'); ok = false; }
      if (!ok) return;
      const btn = f.querySelector('button[type=submit]');
      U.busy(btn, true, 'Salvando...');
      try {
        await updateOrg({ nome, cnpj: cnpj || null, dias_alerta_vencimento: dias,
                          praca_pagamento: f.praca_pagamento.value.trim() || null });
        U.toast('Organização atualizada.', 'success');
      } catch (err) { U.toast(U.errorMessage(err), 'error'); }
      U.busy(btn, false);
    });

    const c = document.getElementById('form-compliance');
    c.addEventListener('submit', async (e) => {
      e.preventDefault();
      U.clearErrors(c);
      const taxa = c.taxa.value.trim() ? U.parsePercent(c.taxa.value) : null;
      const validado = c.validado.checked;
      const responsavel = c.responsavel.value.trim();
      let ok = true;
      if (c.taxa.value.trim() && (taxa === null || F.rateFromPercent(taxa) >= F.RATE_SCALE)) { U.fieldError(c, 'taxa', 'Taxa inválida (menor que 100).'); ok = false; }
      if (c.data.value && c.data.value > U.today()) { U.fieldError(c, 'data', 'A data não pode ser futura.'); ok = false; }
      if (validado) {
        if (taxa === null) { U.fieldError(c, 'taxa', 'Obrigatório para registrar a validação.'); ok = false; }
        if (!c.data.value) { U.fieldError(c, 'data', 'Obrigatório para registrar a validação.'); ok = false; }
        if (responsavel.length < 3) { U.fieldError(c, 'responsavel', 'Obrigatório para registrar a validação.'); ok = false; }
      }
      if (!ok) { U.focusFirstError(c); return; }
      const btn = c.querySelector('button[type=submit]');
      U.busy(btn, true, 'Salvando...');
      try {
        await updateOrg({
          taxa_juros_max_mensal: taxa === null ? null : F.rateToString(F.rateFromPercent(taxa)),
          enquadramento_validado: validado,
          enquadramento_responsavel: responsavel || null,
          enquadramento_data: c.data.value || null,
          enquadramento_observacoes: c.observacoes.value.trim() || null,
        });
        U.toast(taxa === null ? 'Configuração salva. Sem limite de taxa.' : 'Configuração salva. Limite de taxa aplicado aos novos contratos.', 'success');
      } catch (err) { U.toast(U.errorMessage(err), 'error'); }
      U.busy(btn, false);
    });

    if (!Auth.can('config.write')) {
      [f, c].forEach((form) => form.querySelectorAll('input, textarea, select').forEach((el) => { el.disabled = true; }));
    }
  }

  // ------------------------------------------------------------------ usuários
  async function loadProfiles() {
    const { data, error } = await Auth.client.from('profiles').select('id, nome, email, papel, ativo, created_at')
      .eq('organizacao_id', Auth.org.id).order('nome');
    if (error) throw error;
    profilesById = Object.fromEntries(data.map((p) => [p.id, p]));
    return data;
  }

  async function renderUsers() {
    const el = document.getElementById('users');
    el.innerHTML = U.loadingHTML();
    try {
      const users = await loadProfiles();
      el.innerHTML = `<div class="table-wrap"><table class="table responsive"><thead><tr><th>Nome</th><th>E-mail</th><th>Papel</th><th>Situação</th><th></th></tr></thead><tbody>
        ${users.map((u) => `<tr data-id="${esc(u.id)}">
          <td data-label="Nome">${esc(u.nome || '—')}${u.id === Auth.profile.id ? ' ' + U.badge('Você', 'info') : ''}</td>
          <td data-label="E-mail">${esc(u.email)}</td>
          <td data-label="Papel"><select data-field="papel" aria-label="Papel">${U.options(U.LABELS.papel, u.papel)}</select></td>
          <td data-label="Situação"><label class="checkbox"><input type="checkbox" data-field="ativo" ${u.ativo ? 'checked' : ''}> Ativo</label></td>
          <td class="actions"><button class="btn btn-sm" data-save>Salvar</button></td></tr>`).join('')}
        </tbody></table></div>`;
      el.querySelectorAll('[data-save]').forEach((b) => b.addEventListener('click', async () => {
        const tr = b.closest('tr');
        const papel = tr.querySelector('[data-field=papel]').value;
        const ativo = tr.querySelector('[data-field=ativo]').checked;
        U.busy(b, true, '');
        try {
          await U.rpc('atualizar_usuario', { p_usuario_id: tr.dataset.id, p_papel: papel, p_ativo: ativo });
          U.toast('Usuário atualizado.', 'success');
          if (tr.dataset.id === Auth.profile.id) { location.reload(); return; }
        } catch (err) { U.toast(U.errorMessage(err), 'error'); }
        U.busy(b, false);
      }));
    } catch (err) {
      el.innerHTML = U.errorHTML(U.errorMessage(err), false);
    }
  }

  function bindUsers() {
    const f = document.getElementById('form-link');
    f.papel.innerHTML = U.options(U.LABELS.papel, 'operador');
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = f.email.value.trim().toLowerCase();
      if (!U.validEmail(email)) { U.toast('Informe um e-mail válido.', 'error'); return; }
      const btn = f.querySelector('button[type=submit]');
      U.busy(btn, true, '');
      try {
        await U.rpc('vincular_usuario', { p_email: email, p_papel: f.papel.value });
        U.toast('Usuário vinculado à organização.', 'success');
        f.reset();
        f.papel.value = 'operador';
        renderUsers();
      } catch (err) { U.toast(U.errorMessage(err), 'error', 9000); }
      U.busy(btn, false);
    });
  }

  // ------------------------------------------------------------------ perfil e senha
  function bindProfile() {
    const f = document.getElementById('form-profile');
    f.nome.value = Auth.profile.nome || '';
    f.querySelector('#p-email').value = Auth.profile.email;
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      U.clearErrors(f);
      const nome = f.nome.value.trim();
      if (nome.length < 3) { U.fieldError(f, 'nome', 'Informe seu nome completo.'); return; }
      const btn = f.querySelector('button[type=submit]');
      U.busy(btn, true, 'Salvando...');
      try {
        const { data, error } = await Auth.client.from('profiles').update({ nome }).eq('id', Auth.profile.id).select('id');
        if (error) throw error;
        if (!data.length) throw new Error('Não foi possível atualizar o perfil.');
        Auth.profile.nome = nome;
        U.toast('Perfil atualizado.', 'success');
      } catch (err) { U.toast(U.errorMessage(err), 'error'); }
      U.busy(btn, false);
    });

    const p = document.getElementById('form-password');
    p.addEventListener('submit', async (e) => {
      e.preventDefault();
      U.clearErrors(p);
      if (!U.strongPassword(p.password.value)) { U.fieldError(p, 'password', 'Mínimo de 8 caracteres, com letras e números.'); return; }
      if (p.password.value !== p.password2.value) { U.fieldError(p, 'password2', 'As senhas não conferem.'); return; }
      const btn = p.querySelector('button[type=submit]');
      U.busy(btn, true, 'Alterando...');
      try {
        const { error } = await Auth.client.auth.updateUser({ password: p.password.value });
        if (error) throw error;
        p.reset();
        U.toast('Senha alterada com sucesso.', 'success');
      } catch (err) { U.toast(U.errorMessage(err), 'error'); }
      U.busy(btn, false);
    });
  }

  // ------------------------------------------------------------------ auditoria
  function showAuditDetail(row) {
    const pretty = (o) => (o ? esc(JSON.stringify(o, null, 2)) : '—');
    U.modal({
      title: `Auditoria #${row.id}`,
      size: 'lg',
      body: `<dl class="dl mb-2"><dt>Data</dt><dd>${esc(U.datetime(row.created_at))}</dd>
          <dt>Usuário</dt><dd>${esc((profilesById[row.usuario_id] || {}).nome || row.usuario_id || 'Sistema')}</dd>
          <dt>Tabela</dt><dd>${esc(row.tabela)}</dd><dt>Ação</dt><dd>${esc(row.acao)}</dd><dt>Registro</dt><dd class="mono small">${esc(row.registro_id || '—')}</dd></dl>
        <div class="grid grid-2"><div><div class="section-title">Antes</div><pre class="json">${pretty(row.dados_antigos)}</pre></div>
          <div><div class="section-title">Depois</div><pre class="json">${pretty(row.dados_novos)}</pre></div></div>`,
      footer: '<button type="button" class="btn btn-primary" data-close>Fechar</button>',
    });
  }

  async function initAudit() {
    document.getElementById('card-audit').classList.remove('hidden');
    if (!Object.keys(profilesById).length) { try { await loadProfiles(); } catch (_) { /* nomes opcionais */ } }
    const tabelas = ['clientes', 'contratos', 'parcelas', 'pagamentos', 'movimentacoes_caixa', 'organizacoes', 'profiles'];
    const table = new DataTable({
      container: document.getElementById('tbl-audit'),
      search: false,
      pageSize: 20,
      filters: [
        { key: 'tabela', label: 'Tabela', type: 'select', value: '', options: [{ value: '', label: 'Todas as tabelas' }, ...tabelas.map((t) => ({ value: t, label: t }))] },
        { key: 'acao', label: 'Ação', type: 'select', value: '', options: [{ value: '', label: 'Todas as ações' },
          ...['INSERT', 'UPDATE', 'DELETE', 'ACESSO_CPF', 'ANONIMIZACAO'].map((a) => ({ value: a, label: a }))] },
        { key: 'de', label: 'A partir de', type: 'date', value: '' },
      ],
      columns: [
        { label: 'Data', render: (r) => esc(U.datetime(r.created_at)) },
        { label: 'Usuário', render: (r) => esc((profilesById[r.usuario_id] || {}).nome || (r.usuario_id ? r.usuario_id.slice(0, 8) : 'Sistema')) },
        { label: 'Tabela', render: (r) => esc(r.tabela) },
        { label: 'Ação', render: (r) => U.badge(r.acao, r.acao === 'ACESSO_CPF' || r.acao === 'ANONIMIZACAO' ? 'warning' : r.acao === 'INSERT' ? 'success' : 'info') },
        { label: 'Registro', render: (r) => `<span class="mono small">${esc((r.registro_id || '').slice(0, 8))}</span>` },
        { label: '', className: 'actions', render: () => '<button class="btn btn-sm" data-action="view">Detalhes</button>' },
      ],
      fetch: async ({ from, to, filters }) => {
        let q = Auth.client.from('auditoria').select('*', { count: 'exact' }).order('created_at', { ascending: false }).range(from, to);
        if (filters.tabela) q = q.eq('tabela', filters.tabela);
        if (filters.acao) q = q.eq('acao', filters.acao);
        if (filters.de) q = q.gte('created_at', filters.de);
        const { data, error, count } = await q;
        if (error) throw error;
        return { rows: data, total: count };
      },
      onAction: (action, row) => { if (action === 'view') showAuditDetail(row); },
    });
    await table.load();
  }

  App.page('configuracoes', 'Configurações', async () => {
    const isAdmin = Auth.can('config.write');
    document.querySelectorAll('.admin-only').forEach((el) => el.classList.toggle('hidden', !isAdmin));
    fillOrg();
    bindOrgForms();
    bindProfile();
    if (isAdmin) { bindUsers(); await renderUsers(); }
    if (Auth.can('auditoria.read')) await initAudit();
  });
})();

/* ==========================================================================
 * finance.test.js
 * ========================================================================== */
/*
 * Testes automatizados do motor financeiro (js/finance.js).
 *
 * Execução:
 *   Abra index.html#testes no navegador (funciona também no GitHub Pages).
 */
(function (root) {
  'use strict';
  if (location.hash !== '#testes') return;
  const F = typeof module === 'object' && module.exports ? require('../js/finance.js') : root.Finance;
  const results = [];

  function test(name, fn) {
    try { fn(); results.push({ name, ok: true }); }
    catch (e) { results.push({ name, ok: false, error: e && e.message ? e.message : String(e) }); }
  }
  function eq(actual, expected, msg) {
    if (actual !== expected) throw new Error(`${msg || 'valor'}: esperado ${String(expected)}, obtido ${String(actual)}`);
  }
  function ok(cond, msg) { if (!cond) throw new Error(msg || 'condição falsa'); }
  function throws(fn, msg) {
    let threw = false;
    try { fn(); } catch (_) { threw = true; }
    if (!threw) throw new Error(msg || 'era esperada uma exceção');
  }
  const c = (s) => F.toCents(s);

  // ---------------------------------------------------------------- decimais
  test('parseDecimal arredonda half-up', () => {
    eq(F.parseDecimal('1.005', 2), 101n);
    eq(F.parseDecimal('1.004', 2), 100n);
    eq(F.parseDecimal('0.1', 2) + F.parseDecimal('0.2', 2), 30n, '0,1 + 0,2 exato');
    eq(F.parseDecimal('2.5', 6), 2500000n, '2,5% → 0,025 em escala 1e8');
  });
  test('parseDecimal rejeita formatos inválidos', () => {
    throws(() => F.parseDecimal('1,5', 2));
    throws(() => F.parseDecimal('abc', 2));
    throws(() => F.parseDecimal('', 2));
  });
  test('centsToString formata', () => {
    eq(F.centsToString(123456n), '1234.56');
    eq(F.centsToString(5n), '0.05');
    eq(F.centsToString(0n), '0.00');
  });
  test('divRound half-up', () => {
    eq(F.divRound(5n, 2n), 3n);
    eq(F.divRound(4n, 3n), 1n);
    eq(F.divRound(5n, 3n), 2n);
  });

  // ---------------------------------------------------------------- datas
  test('addMonths ajusta fim de mês', () => {
    eq(F.addMonths('2026-01-31', 1), '2026-02-28');
    eq(F.addMonths('2026-01-31', 2), '2026-03-31');
    eq(F.addMonths('2028-01-31', 1), '2028-02-29', 'ano bissexto');
    eq(F.addMonths('2026-11-15', 3), '2027-02-15', 'virada de ano');
  });
  test('vencimentos semanais e quinzenais', () => {
    eq(F.dueDate('2026-12-28', 'semanal', 2), '2027-01-04');
    eq(F.dueDate('2026-02-10', 'quinzenal', 3), '2026-03-12');
    eq(F.defaultFirstDue('2026-01-31', 'mensal'), '2026-02-28');
  });
  test('diffDays', () => {
    eq(F.diffDays('2026-01-01', '2026-03-01'), 59);
    eq(F.diffDays('2026-03-01', '2026-01-01'), -59);
  });

  // ---------------------------------------------------------------- PRICE
  test('PRICE 1.000,00 a 1% a.m. em 12x: parcela 88,85', () => {
    const s = F.schedule({ principal: '1000.00', taxaMensalPct: '1', parcelas: 12, frequencia: 'mensal',
                           sistema: 'PRICE', primeiroVencimento: '2026-02-10' });
    eq(s.rows[0].total, c('88.85'), 'parcela 1');
    eq(s.rows[0].juros, c('10.00'), 'juros 1');
    eq(s.totalPrincipal, c('1000.00'), 'amortização total');
    eq(s.total, s.totalPrincipal + s.totalJuros + s.totalEncargos, 'total coerente');
    for (let k = 0; k < 11; k++) eq(s.rows[k].total, c('88.85'), 'parcela constante ' + (k + 1));
    ok(s.rows[11].total >= c('88.80') && s.rows[11].total <= c('88.90'), 'última parcela ajustada');
    eq(s.rows[11].vencimento, '2027-01-10');
  });
  test('PRICE taxa zero divide o principal', () => {
    const s = F.schedule({ principal: '1000.00', taxaMensalPct: '0', parcelas: 3, frequencia: 'mensal',
                           sistema: 'PRICE', primeiroVencimento: '2026-02-10' });
    eq(s.totalJuros, 0n);
    eq(s.rows[0].total, c('333.33'));
    eq(s.rows[2].total, c('333.34'));
    eq(s.total, c('1000.00'));
  });

  // ---------------------------------------------------------------- SAC
  test('SAC 1.200,00 a 2% a.m. em 12x', () => {
    const s = F.schedule({ principal: '1200.00', taxaMensalPct: '2', parcelas: 12, frequencia: 'mensal',
                           sistema: 'SAC', primeiroVencimento: '2026-02-10' });
    s.rows.forEach((r) => eq(r.principal, c('100.00'), 'amortização constante'));
    eq(s.rows[0].juros, c('24.00'));
    eq(s.rows[11].juros, c('2.00'));
    eq(s.totalJuros, c('156.00'));
    eq(s.valorParcela, c('124.00'));
  });
  test('SAC com divisão não exata fecha o principal', () => {
    const s = F.schedule({ principal: '1000.00', taxaMensalPct: '0', parcelas: 3, frequencia: 'mensal',
                           sistema: 'SAC', primeiroVencimento: '2026-02-10' });
    eq(s.rows.map((r) => F.centsToString(r.principal)).join('|'), '333.33|333.34|333.33');
  });

  // ---------------------------------------------------------------- encargos
  test('encargos distribuídos somam exatamente', () => {
    const s = F.schedule({ principal: '500.00', taxaMensalPct: '1.5', parcelas: 7, frequencia: 'mensal',
                           sistema: 'PRICE', encargos: '10.00', primeiroVencimento: '2026-02-10' });
    eq(s.totalEncargos, c('10.00'));
    s.rows.forEach((r) => ok(r.encargos >= 0n, 'encargo não negativo'));
  });
  test('encargos pequenos não geram valores negativos', () => {
    const s = F.schedule({ principal: '100.00', taxaMensalPct: '1', parcelas: 10, frequencia: 'mensal',
                           sistema: 'SAC', encargos: '0.05', primeiroVencimento: '2026-02-10' });
    eq(s.totalEncargos, c('0.05'));
    s.rows.forEach((r) => ok(r.encargos >= 0n && r.principal >= 0n, 'sem negativos'));
  });

  // ---------------------------------------------------------------- frequências
  test('taxa equivalente semanal e quinzenal', () => {
    const i = F.rateFromPercent('10');
    eq(F.periodRate(i, 'mensal'), i);
    const sem = Number(F.periodRate(i, 'semanal')) / 1e8;
    const qui = Number(F.periodRate(i, 'quinzenal')) / 1e8;
    ok(Math.abs(sem - (Math.pow(1.1, 7 / 30) - 1)) < 1e-8, 'semanal');
    ok(Math.abs(qui - (Math.pow(1.1, 0.5) - 1)) < 1e-8, 'quinzenal');
  });

  // ---------------------------------------------------------------- invariantes
  test('invariantes em 300 combinações aleatórias', () => {
    let seed = 42;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const freqs = ['mensal', 'quinzenal', 'semanal'];
    for (let t = 0; t < 300; t++) {
      const principal = (100 + Math.floor(rnd() * 5000000)) / 100;
      const pct = (Math.floor(rnd() * 800000) / 100000).toFixed(5);
      const n = 1 + Math.floor(rnd() * 120);
      const p = { principal: principal.toFixed(2), taxaMensalPct: pct, parcelas: n,
                  frequencia: freqs[t % 3], sistema: t % 2 ? 'SAC' : 'PRICE',
                  encargos: (Math.floor(rnd() * 5000) / 100).toFixed(2), primeiroVencimento: '2026-03-31' };
      const s = F.schedule(p);
      eq(s.totalPrincipal, c(p.principal), `principal fecha (#${t})`);
      eq(s.totalEncargos, c(p.encargos), `encargos fecham (#${t})`);
      eq(s.rows.length, n);
      let saldo = c(p.principal);
      s.rows.forEach((r) => {
        ok(r.principal >= 0n && r.juros >= 0n && r.encargos >= 0n, `sem negativos (#${t})`);
        eq(r.saldoInicial, saldo, `saldo encadeado (#${t})`);
        eq(r.total, r.principal + r.juros + r.encargos);
        saldo -= r.principal;
      });
      eq(saldo, 0n, `saldo final zero (#${t})`);
    }
  });

  // ---------------------------------------------------------------- CET
  test('CET sem encargos ≈ taxa contratada', () => {
    const s = F.schedule({ principal: '1000.00', taxaMensalPct: '3', parcelas: 12, frequencia: 'mensal',
                           sistema: 'PRICE', primeiroVencimento: '2026-02-01', dataContratacao: '2026-01-01' });
    ok(Math.abs(s.cetMensal - 0.03) < 0.001, 'CET ' + s.cetMensal);
  });
  test('CET aumenta com encargos', () => {
    const base = { principal: '1000.00', taxaMensalPct: '3', parcelas: 12, frequencia: 'mensal', sistema: 'PRICE',
                   primeiroVencimento: '2026-02-01', dataContratacao: '2026-01-01' };
    const a = F.schedule(base);
    const b = F.schedule(Object.assign({}, base, { encargos: '50.00' }));
    ok(b.cetMensal > a.cetMensal, 'CET maior');
  });

  // ---------------------------------------------------------------- validações
  test('rejeita parâmetros inválidos', () => {
    const base = { principal: '1000.00', taxaMensalPct: '1', parcelas: 12, frequencia: 'mensal', sistema: 'PRICE',
                   primeiroVencimento: '2026-02-10' };
    throws(() => F.schedule(Object.assign({}, base, { principal: '0.50' })), 'principal mínimo');
    throws(() => F.schedule(Object.assign({}, base, { parcelas: 0 })), 'parcelas mínimo');
    throws(() => F.schedule(Object.assign({}, base, { parcelas: 361 })), 'parcelas máximo');
    throws(() => F.schedule(Object.assign({}, base, { frequencia: 'diaria' })), 'frequência');
    throws(() => F.schedule(Object.assign({}, base, { sistema: 'SAM' })), 'sistema');
    throws(() => F.schedule(Object.assign({}, base, { taxaMensalPct: '100' })), 'taxa');
  });

  // ---------------------------------------------------------------- imputação
  test('imputação de pagamento: juros → encargos → principal', () => {
    const parc = { juros: c('10.00'), encargos: c('2.00'), principal: c('80.00'),
                   pagoJuros: 0n, pagoEncargos: 0n, pagoPrincipal: 0n };
    const a = F.allocatePayment(parc, c('11.00'));
    eq(a.juros, c('10.00')); eq(a.encargos, c('1.00')); eq(a.principal, 0n);
    const b = F.allocatePayment(Object.assign({}, parc, { pagoJuros: c('10.00'), pagoEncargos: c('1.00') }), c('81.00'));
    eq(b.juros, 0n); eq(b.encargos, c('1.00')); eq(b.principal, c('80.00'));
    throws(() => F.allocatePayment(parc, c('92.01')), 'excede saldo');
    throws(() => F.allocatePayment(parc, 0n), 'valor zero');
  });

  // ---------------------------------------------------------------- extenso
  test('números por extenso', () => {
    const casos = { 0: 'zero', 1: 'um', 16: 'dezesseis', 21: 'vinte e um', 100: 'cem', 101: 'cento e um',
      115: 'cento e quinze', 999: 'novecentos e noventa e nove', 1000: 'mil', 1001: 'mil e um', 1100: 'mil e cem',
      1234: 'mil duzentos e trinta e quatro', 2026: 'dois mil e vinte e seis', 21000: 'vinte e um mil',
      1000000: 'um milhão', 2000000: 'dois milhões', 1000100: 'um milhão e cem',
      1234567: 'um milhão, duzentos e trinta e quatro mil quinhentos e sessenta e sete' };
    Object.entries(casos).forEach(([n, t]) => eq(F.numeroPorExtenso(Number(n)), t, String(n)));
  });
  test('valores em reais por extenso', () => {
    eq(F.valorPorExtenso('1.00'), 'um real');
    eq(F.valorPorExtenso('2.00'), 'dois reais');
    eq(F.valorPorExtenso('0.01'), 'um centavo');
    eq(F.valorPorExtenso('0.50'), 'cinquenta centavos');
    eq(F.valorPorExtenso('88.85'), 'oitenta e oito reais e oitenta e cinco centavos');
    eq(F.valorPorExtenso('1001.50'), 'mil e um reais e cinquenta centavos');
    eq(F.valorPorExtenso('1000000.00'), 'um milhão de reais');
    eq(F.valorPorExtenso('2500000.00'), 'dois milhões e quinhentos mil reais');
    eq(F.valorPorExtenso('1234567.89'), 'um milhão, duzentos e trinta e quatro mil quinhentos e sessenta e sete reais e oitenta e nove centavos');
  });
  test('datas por extenso', () => {
    const d = F.dataPorExtenso('2026-11-01');
    eq(d.mes, 'novembro'); eq(d.diaExtenso, 'um'); eq(d.anoExtenso, 'dois mil e vinte e seis');
  });

  // ---------------------------------------------------------------- saída
  const failed = results.filter((r) => !r.ok);
  if (typeof module === 'object' && module.exports) {
    results.forEach((r) => console.log(`${r.ok ? '✔' : '✘'} ${r.name}${r.ok ? '' : ' — ' + r.error}`));
    console.log(`\n${results.length - failed.length}/${results.length} testes passaram.`);
    if (failed.length) process.exitCode = 1;
  } else {
    root.FinanceTestResults = results;
  }
})(typeof self !== 'undefined' ? self : this);

/* ==========================================================================
 * test-runner.js
 * ========================================================================== */
(function () {
  'use strict';
  if (location.hash !== '#testes') return;
  const results = window.FinanceTestResults || [];
  const list = document.getElementById('results');
  const summary = document.getElementById('summary');
  results.forEach((r) => {
    const li = document.createElement('li');
    li.className = r.ok ? 'pass' : 'fail';
    li.textContent = (r.ok ? '✔ ' : '✘ ') + r.name + (r.ok ? '' : ' — ' + r.error);
    list.appendChild(li);
  });
  const failed = results.filter((r) => !r.ok).length;
  summary.textContent = `${results.length - failed}/${results.length} testes passaram.`;
  summary.classList.add(failed ? 'alert-danger' : 'alert-success');
})();

/* Inicialização */
App.boot();
