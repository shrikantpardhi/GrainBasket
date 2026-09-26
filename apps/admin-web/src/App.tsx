import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { api, setCsrf, type Catalog, type Category, type Kind, type Locale, type Offer,
  type Overview, type Product, type Role, type Session, type Staff,
  type Store, type StoreHour, type Variant } from './api';
import { translator, weekdays } from './i18n';

type T = ReturnType<typeof translator>;
type RunAction = (work: () => Promise<unknown>, result?: 'saved' | 'created') => Promise<boolean>;
type Tab = 'overview' | 'stores' | 'catalog' | 'team';
type Names = { en: string; hi: string; mr: string };
const emptyNames = (): Names => ({ en: '', hi: '', mr: '' });
const emptyHours = (): StoreHour[] => weekdays.map((_, weekday) => ({
  weekday, closed: true, opensAt: null, closesAt: null, orderCutoffAt: null,
}));

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

function LanguageSelect({ locale, onChange }: { locale: Locale; onChange: (value: Locale) => void }) {
  return <select aria-label="Language" className="language-select" value={locale}
    onChange={(event) => onChange(event.target.value as Locale)}>
    <option value="en">English</option><option value="hi">हिंदी</option><option value="mr">मराठी</option>
  </select>;
}

function SignIn({ t, locale, setLocale, onLogin }: {
  t: T; locale: Locale; setLocale: (locale: Locale) => void; onLogin: (session: Session) => void;
}) {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const session = await api<Session>('/admin/login', 'POST', { login, password });
      setPassword(''); onLogin(session);
    } catch (failure) { setError(failure instanceof Error ? failure.message : t('failed')); }
    finally { setBusy(false); }
  }
  return <div className="login-page">
    <div className="login-hero"><div className="login-hero-inner">
      <div className="brand brand-light"><span className="brand-mark">G</span><span>grainbasket<small>STORE OPERATIONS</small></span></div>
      <div className="hero-copy"><div className="eyebrow light">GRAINBASKET / ADMIN</div>
        <h1>{t('signInIntro')}</h1><p>{t('signInDetail')}</p>
        <div className="hero-rule" /><span>FLOUR · RICE · GOOD WORK</span></div>
    </div></div>
    <div className="login-content"><div className="login-top"><LanguageSelect locale={locale} onChange={setLocale} /></div>
      <form className="login-card" onSubmit={submit}>
        <div className="eyebrow">{t('security')}</div><h2>{t('adminWorkspace')}</h2>
        <p>{t('signInDetail')}</p>
        <Field label={t('loginName')}><input autoComplete="username" required value={login}
          onChange={(event) => setLogin(event.target.value)} /></Field>
        <Field label={t('password')}><input type="password" autoComplete="current-password" required value={password}
          onChange={(event) => setPassword(event.target.value)} /></Field>
        {error && <div className="alert error" role="alert">{error}</div>}
        <button type="submit" className="button primary wide" disabled={busy}>{t('signIn')} <span aria-hidden>↗</span></button>
      </form><div className="login-foot">GRAINBASKET · NAGPUR</div>
    </div>
  </div>;
}

function OverviewPage({ t, store, summary, toStores }: {
  t: T; store: Store | undefined; summary: Overview | null; toStores: () => void;
}) {
  const cards = [
    { label: t('activeOffers'), number: summary?.stock.offers ?? 0, caption: t('sharedCatalog') },
    { label: t('availableStock'), number: summary?.stock.available ?? 0, caption: t('stock') },
    { label: t('activeStaff'), number: summary?.staff.active ?? 0, caption: t('team') },
    { label: t('placedOrders'), number: summary?.orders.placed ?? 0, caption: t('overview') },
  ];
  return <><div className="page-heading"><div><div className="eyebrow">{t('operations')} / {t('overview')}</div>
    <h1>{t('welcome')}.</h1><p>{t('overviewIntro')}</p></div><div className="heading-decor">01 <span>/ 04</span></div></div>
    <div className="feature-banner"><div><div className="eyebrow light">{t('chosenStore')}</div>
      <h2>{store?.name ?? t('noStore')}</h2><p>{store?.address ?? t('completeProfile')}</p></div>
      <div className={`status-pill ${store?.orderingEnabled ? 'on' : ''}`}>
        <span className="status-dot" />{store?.orderingEnabled ? t('ready') : t('paused')}</div></div>
    <div className="section-heading"><h2>{t('todayAt')}</h2><span className="small-label">{store?.name}</span></div>
    <div className="metrics">{cards.map((item) => <div className="metric-card" key={item.label}>
      <div className="metric-label">{item.label}</div><strong>{item.number}</strong><span>{item.caption}</span>
    </div>)}</div>
    <div className="overview-bottom"><div className="panel readiness"><div className="eyebrow">{t('storeReadiness')}</div>
      <h3>{store?.orderingEnabled ? t('ready') : t('paused')}</h3><p>{t('setupNeeded')}</p>
      <button className="button secondary" onClick={toStores}>{t('openSettings')} <span aria-hidden>→</span></button></div>
      <div className="panel note-panel"><div className="eyebrow">GRAINBASKET / V1.0</div>
        <h3>{t('gettingStarted')}</h3><p>{t('gettingStartedInfo')}</p>
        <div className="note-pattern" aria-hidden>G</div></div></div>
  </>;
}

interface StoreDraft {
  name: string; address: string; contactPhone: string; preparation: string; deliveryFee: string;
  orderingEnabled: boolean; hours: StoreHour[]; pickupText: string; pincodeText: string;
}

function StoreEditor({ store, t, run }: { store: Store; t: T; run: RunAction }) {
  const draftFromStore = useCallback((): StoreDraft => ({
    name: store.name, address: store.address, contactPhone: store.contactPhone,
    preparation: store.preparationLeadMinutes?.toString() ?? '', deliveryFee: store.deliveryFee ?? '',
    orderingEnabled: store.orderingEnabled,
    hours: weekdays.map((_, weekday) => store.hours.find((day) => day.weekday === weekday) ?? emptyHours()[weekday]!),
    pickupText: store.pickupTimes.map((slot) => `${slot.weekday} ${slot.pickupAt}`).join('\n'),
    pincodeText: store.deliveryPincodes.join(', '),
  }), [store]);
  const [draft, setDraft] = useState<StoreDraft>(draftFromStore);
  useEffect(() => setDraft(draftFromStore()), [draftFromStore]);
  const [reward, setReward] = useState({ pointsPerInr: store.rewards?.pointsPerInr ?? '',
    minimumRedemptionPoints: store.rewards?.minimumRedemptionPoints?.toString() ?? '',
    pointValueInr: store.rewards?.pointValueInr ?? '',
    maximumRedemptionPoints: store.rewards?.maximumRedemptionPoints?.toString() ?? '' });
  useEffect(() => setReward({ pointsPerInr: store.rewards?.pointsPerInr ?? '',
    minimumRedemptionPoints: store.rewards?.minimumRedemptionPoints?.toString() ?? '',
    pointValueInr: store.rewards?.pointValueInr ?? '',
    maximumRedemptionPoints: store.rewards?.maximumRedemptionPoints?.toString() ?? '' }), [store]);

  function changeDay(index: number, value: StoreHour) {
    setDraft((current) => ({ ...current, hours: current.hours.map((day) => day.weekday === index ? value : day) }));
  }
  function saveStore(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      const pickupTimes = draft.pickupText.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
        const match = /^([0-6])\s+([0-2][0-9]:[0-5][0-9])$/.exec(line);
        if (!match) throw new Error(t('pickupHelp'));
        return { weekday: Number(match[1]), pickupAt: match[2]! };
      });
      await api<void>(`/admin/stores/${store.id}`, 'PUT', {
        name: draft.name, address: draft.address, contactPhone: draft.contactPhone,
        preparationLeadMinutes: Number(draft.preparation), deliveryFee: draft.deliveryFee,
        orderingEnabled: draft.orderingEnabled, hours: draft.hours,
        pickupTimes, deliveryPincodes: draft.pincodeText.split(',').map((value) => value.trim()).filter(Boolean),
      });
    });
  }
  function saveRewards(event: FormEvent) {
    event.preventDefault();
    void run(() => api<void>(`/admin/stores/${store.id}/rewards`, 'PUT', {
      pointsPerInr: reward.pointsPerInr, minimumRedemptionPoints: Number(reward.minimumRedemptionPoints),
      pointValueInr: reward.pointValueInr, maximumRedemptionPoints: Number(reward.maximumRedemptionPoints),
    }));
  }
  return <div className="store-columns"><form className="panel form-panel" onSubmit={saveStore}>
    <div className="panel-title"><span className="step-number">01</span><h2>{t('identity')}</h2></div>
    <div className="form-grid"><Field label={t('storeName')}><input required value={draft.name}
      onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></Field>
      <Field label={t('phone')}><input required value={draft.contactPhone}
        onChange={(event) => setDraft({ ...draft, contactPhone: event.target.value })} /></Field>
      <div className="span-2"><Field label={t('address')}><textarea rows={2} required value={draft.address}
        onChange={(event) => setDraft({ ...draft, address: event.target.value })} /></Field></div>
      <Field label={t('preparation')}><input type="number" min="1" max="1440" required value={draft.preparation}
        onChange={(event) => setDraft({ ...draft, preparation: event.target.value })} /></Field>
      <Field label={t('deliveryFee')}><input type="number" min="0" step="0.01" required value={draft.deliveryFee}
        onChange={(event) => setDraft({ ...draft, deliveryFee: event.target.value })} /></Field></div>

    <div className="panel-title border-top"><span className="step-number">02</span><h2>{t('hours')}</h2></div>
    <div className="hours-table"><div className="hours-head"><span>{t('day')}</span><span>{t('closed')}</span>
      <span>{t('opens')}</span><span>{t('closes')}</span><span>{t('cutoff')}</span></div>
      {draft.hours.map((day) => <div className="hours-row" key={day.weekday}>
        <strong>{t(weekdays[day.weekday]!)}</strong><input type="checkbox" aria-label={`${t(weekdays[day.weekday]!)} ${t('closed')}`}
          checked={day.closed} onChange={(event) => changeDay(day.weekday, event.target.checked
            ? { ...day, closed: true, opensAt: null, closesAt: null, orderCutoffAt: null }
            : { ...day, closed: false, opensAt: '', closesAt: '', orderCutoffAt: '' })} />
        {(['opensAt', 'closesAt', 'orderCutoffAt'] as const).map((key) => <input key={key} type="time"
          aria-label={`${t(weekdays[day.weekday]!)} ${key}`} disabled={day.closed} required={!day.closed}
          value={day[key] ?? ''} onChange={(event) => changeDay(day.weekday, { ...day, [key]: event.target.value })} />)}
      </div>)}</div>
    <div className="panel-title border-top"><span className="step-number">03</span><h2>{t('pickup')} & {t('delivery')}</h2></div>
    <div className="form-grid"><Field label={t('pickup')} hint={t('pickupHelp')}><textarea rows={3}
      value={draft.pickupText} onChange={(event) => setDraft({ ...draft, pickupText: event.target.value })} /></Field>
      <Field label={t('delivery')} hint={t('deliveryHelp')}><textarea rows={3}
        value={draft.pincodeText} onChange={(event) => setDraft({ ...draft, pincodeText: event.target.value })} /></Field></div>
    <label className="switch-line"><input type="checkbox" checked={draft.orderingEnabled}
      onChange={(event) => setDraft({ ...draft, orderingEnabled: event.target.checked })} />
      <span><strong>{t('ordering')}</strong><small>{t('orderingHelp')}</small></span></label>
    <div className="form-actions"><button className="button primary" type="submit">{t('save')}</button></div>
  </form><div className="side-stack"><form className="panel form-panel" onSubmit={saveRewards}>
    <div className="panel-title"><span className="step-number">04</span><h2>{t('rewards')}</h2></div>
    <p className="form-explainer">{t('rewardsHelp')}</p>
    <div className="form-grid compact"><Field label={t('earnRate')}><input type="number" step="0.0001" min="0.0001" required
      value={reward.pointsPerInr} onChange={(event) => setReward({ ...reward, pointsPerInr: event.target.value })} /></Field>
      <Field label={t('pointValue')}><input type="number" step="0.01" min="0.01" required value={reward.pointValueInr}
        onChange={(event) => setReward({ ...reward, pointValueInr: event.target.value })} /></Field>
      <Field label={t('minPoints')}><input type="number" min="1" required value={reward.minimumRedemptionPoints}
        onChange={(event) => setReward({ ...reward, minimumRedemptionPoints: event.target.value })} /></Field>
      <Field label={t('maxPoints')}><input type="number" min="1" required value={reward.maximumRedemptionPoints}
        onChange={(event) => setReward({ ...reward, maximumRedemptionPoints: event.target.value })} /></Field></div>
    <div className="form-actions"><button className="button secondary" type="submit">{t('saveRewards')}</button></div>
  </form><div className="tip-card"><span className="tip-line" /><div className="eyebrow light">GRAINBASKET / TWO STORES</div>
      <p>{t('storeIntro')}</p></div></div></div>;
}

function StorePage({ stores, store, t, run, chooseStore }: {
  stores: Store[]; store: Store | undefined; t: T; run: RunAction; chooseStore: (id: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [newStore, setNewStore] = useState({ name: '', address: '', contactPhone: '' });
  async function create(event: FormEvent) {
    event.preventDefault();
    let createdId = '';
    const success = await run(async () => {
      const result = await api<{ id: string }>('/admin/stores', 'POST', newStore);
      createdId = result.id;
    }, 'created');
    if (success) { chooseStore(createdId); setAdding(false); setNewStore({ name: '', address: '', contactPhone: '' }); }
  }
  return <><div className="page-heading"><div><div className="eyebrow">{t('operations')} / {t('stores')}</div>
    <h1>{t('storeSettings')}</h1><p>{t('storeIntro')}</p></div>
    <button className="button secondary" onClick={() => setAdding(!adding)}>{adding ? t('cancel') : `+ ${t('addStore')}`}</button></div>
    <div className="store-tabs">{stores.map((entry) => <button key={entry.id} onClick={() => chooseStore(entry.id)}
      className={`store-tab ${store?.id === entry.id ? 'selected' : ''}`}>
      <span className="store-tab-icon">{entry.name.charAt(0).toUpperCase()}</span>
      <span><strong>{entry.name}</strong><small>{entry.orderingEnabled ? t('ready') : t('paused')}</small></span></button>)}</div>
    {adding && <form className="panel form-panel add-store" onSubmit={(event) => { void create(event); }}>
      <div className="panel-title"><h2>{t('newStore')}</h2></div><div className="form-grid three">
      <Field label={t('storeName')}><input required value={newStore.name}
        onChange={(event) => setNewStore({ ...newStore, name: event.target.value })} /></Field>
      <Field label={t('address')}><input required value={newStore.address}
        onChange={(event) => setNewStore({ ...newStore, address: event.target.value })} /></Field>
      <Field label={t('phone')}><input required value={newStore.contactPhone}
        onChange={(event) => setNewStore({ ...newStore, contactPhone: event.target.value })} /></Field></div>
      <div className="form-actions"><button type="submit" className="button primary">{t('create')}</button></div></form>}
    {store && <StoreEditor store={store} key={store.id} t={t} run={run} />}</>;
}

function localized(catalog: Catalog, entity: { id: string; nameEn: string; descriptionEn: string | null },
  kind: 'categoryId' | 'productId') {
  const names = emptyNames();
  const descriptions = emptyNames();
  names.en = entity.nameEn;
  descriptions.en = entity.descriptionEn ?? '';
  for (const row of catalog.translations.filter((entry) => entry[kind] === entity.id)) {
    names[row.language] = row.name;
    descriptions[row.language] = row.description ?? '';
  }
  return { names, descriptions };
}

function displayName(catalog: Catalog, entity: Category | Product, kind: 'categoryId' | 'productId', locale: Locale) {
  return catalog.translations.find((entry) => entry[kind] === entity.id && entry.language === locale)?.name ?? entity.nameEn;
}

function TranslationFields({ t, names, descriptions, setNames, setDescriptions }: {
  t: T; names: Names; descriptions: Names; setNames: (names: Names) => void;
  setDescriptions: (descriptions: Names) => void;
}) {
  return <div className="translation-grid">{(['en', 'hi', 'mr'] as const).map((code) => <div key={code} className="translation-card">
    <div className="language-heading"><span className="language-code">{code.toUpperCase()}</span>{t(code === 'en' ? 'english' : code === 'hi' ? 'hindi' : 'marathi')}</div>
    <Field label={t('name')}><input required value={names[code]}
      onChange={(event) => setNames({ ...names, [code]: event.target.value })} /></Field>
    <Field label={t('description')}><textarea rows={2} value={descriptions[code]}
      onChange={(event) => setDescriptions({ ...descriptions, [code]: event.target.value })} /></Field>
  </div>)}</div>;
}

function CategoryPanel({ catalog, locale, t, run }: { catalog: Catalog; locale: Locale; t: T; run: RunAction }) {
  const [editing, setEditing] = useState<Category | null>(null);
  const [kind, setKind] = useState<Kind>('FLOUR');
  const [active, setActive] = useState(true);
  const [names, setNames] = useState<Names>(emptyNames);
  const [descriptions, setDescriptions] = useState<Names>(emptyNames);
  function edit(category: Category) {
    setEditing(category); setKind(category.kind); setActive(category.active);
    const translated = localized(catalog, category, 'categoryId');
    setNames(translated.names); setDescriptions(translated.descriptions);
  }
  function reset() { setEditing(null); setKind('FLOUR'); setActive(true); setNames(emptyNames()); setDescriptions(emptyNames()); }
  async function submit(event: FormEvent) {
    event.preventDefault();
    const success = await run(() => api(editing ? `/admin/categories/${editing.id}` : '/admin/categories',
      editing ? 'PUT' : 'POST', { kind, active, names, descriptions }), editing ? 'saved' : 'created');
    if (success) reset();
  }
  return <div className="catalog-layout"><div className="panel list-panel"><div className="panel-title"><h2>{t('categories')}</h2>
    <span className="count-badge">{catalog.categories.length}</span></div>
    {catalog.categories.map((category) => <button className="catalog-list-item" key={category.id} onClick={() => edit(category)}>
      <span className="item-monogram">{category.kind === 'FLOUR' ? 'F' : 'R'}</span>
      <span><strong>{displayName(catalog, category, 'categoryId', locale)}</strong><small>{t(category.kind === 'FLOUR' ? 'flour' : 'rice')}</small></span>
      <span className={`badge ${category.active ? 'active' : ''}`}>{t(category.active ? 'active' : 'inactive')}</span></button>)}
    </div><form className="panel form-panel" onSubmit={(event) => { void submit(event); }}>
      <div className="panel-title"><h2>{editing ? t('edit') : t('addCategory')}</h2>
        {editing && <button className="text-button" type="button" onClick={reset}>{t('cancel')}</button>}</div>
      <div className="form-grid"><Field label={t('kind')}><select disabled={Boolean(editing)} value={kind}
        onChange={(event) => setKind(event.target.value as Kind)}><option value="FLOUR">{t('flour')}</option>
        <option value="RICE">{t('rice')}</option></select></Field>
        <label className="checkbox-field"><input type="checkbox" checked={active}
          onChange={(event) => setActive(event.target.checked)} />{t('active')}</label></div>
      <TranslationFields t={t} names={names} descriptions={descriptions} setNames={setNames} setDescriptions={setDescriptions} />
      <div className="form-actions"><button className="button primary" type="submit">{editing ? t('save') : t('create')}</button></div>
    </form></div>;
}

type ClaimDraft = { textEn: string; evidenceRef: string };
function ProductPanel({ catalog, locale, t, run }: { catalog: Catalog; locale: Locale; t: T; run: RunAction }) {
  const [editing, setEditing] = useState<Product | null>(null);
  const [categoryId, setCategoryId] = useState(catalog.categories[0]?.id ?? '');
  const [names, setNames] = useState<Names>(emptyNames);
  const [descriptions, setDescriptions] = useState<Names>(emptyNames);
  const [imageRef, setImageRef] = useState('');
  const [active, setActive] = useState(true);
  const [claims, setClaims] = useState<Record<'ORGANIC' | 'NUTRITION', ClaimDraft>>({
    ORGANIC: { textEn: '', evidenceRef: '' }, NUTRITION: { textEn: '', evidenceRef: '' },
  });
  useEffect(() => {
    if (!categoryId && catalog.categories[0]) setCategoryId(catalog.categories[0].id);
  }, [catalog.categories, categoryId]);
  function edit(product: Product) {
    setEditing(product); setCategoryId(product.categoryId); setImageRef(product.imageRef ?? ''); setActive(product.active);
    const translated = localized(catalog, product, 'productId');
    setNames(translated.names); setDescriptions(translated.descriptions);
    const current = catalog.claims.filter((claim) => claim.productId === product.id);
    setClaims({
      ORGANIC: { textEn: current.find((claim) => claim.kind === 'ORGANIC')?.textEn ?? '',
        evidenceRef: current.find((claim) => claim.kind === 'ORGANIC')?.evidenceRef ?? '' },
      NUTRITION: { textEn: current.find((claim) => claim.kind === 'NUTRITION')?.textEn ?? '',
        evidenceRef: current.find((claim) => claim.kind === 'NUTRITION')?.evidenceRef ?? '' },
    });
  }
  function reset() {
    setEditing(null); setCategoryId(catalog.categories[0]?.id ?? ''); setNames(emptyNames());
    setDescriptions(emptyNames()); setImageRef(''); setActive(true);
    setClaims({ ORGANIC: { textEn: '', evidenceRef: '' }, NUTRITION: { textEn: '', evidenceRef: '' } });
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    const claimList = (['ORGANIC', 'NUTRITION'] as const).filter((kind) =>
      claims[kind].textEn || claims[kind].evidenceRef).map((kind) => ({ kind, ...claims[kind] }));
    const success = await run(() => api(editing ? `/admin/products/${editing.id}` : '/admin/products',
      editing ? 'PUT' : 'POST', { categoryId, names, descriptions, imageRef: imageRef || null,
        active, claims: claimList }), editing ? 'saved' : 'created');
    if (success) reset();
  }
  return <div className="catalog-layout"><div className="panel list-panel"><div className="panel-title"><h2>{t('products')}</h2>
    <span className="count-badge">{catalog.products.length}</span></div>
    {catalog.products.length === 0 && <p className="empty-copy">{t('noProducts')}</p>}
    {catalog.products.map((product) => <button className="catalog-list-item" key={product.id} onClick={() => edit(product)}>
      <span className="item-monogram">{product.nameEn.charAt(0)}</span>
      <span><strong>{displayName(catalog, product, 'productId', locale)}</strong>
        <small>{catalog.categories.find((entry) => entry.id === product.categoryId)?.nameEn}</small></span>
      <span className={`badge ${product.active ? 'active' : ''}`}>{t(product.active ? 'active' : 'inactive')}</span></button>)}
    </div><form className="panel form-panel" onSubmit={(event) => { void submit(event); }}>
      <div className="panel-title"><h2>{editing ? t('edit') : t('addProduct')}</h2>
        {editing && <button className="text-button" type="button" onClick={reset}>{t('cancel')}</button>}</div>
      <div className="form-grid"><Field label={t('category')}><select required value={categoryId}
        onChange={(event) => setCategoryId(event.target.value)}><option value="">{t('select')}</option>
        {catalog.categories.map((category) => <option key={category.id} value={category.id}>{category.nameEn}</option>)}</select></Field>
        <Field label={t('imageUrl')}><input type="url" placeholder="https://" value={imageRef}
          onChange={(event) => setImageRef(event.target.value)} /></Field></div>
      <TranslationFields t={t} names={names} descriptions={descriptions} setNames={setNames} setDescriptions={setDescriptions} />
      <div className="claim-fields"><div className="section-heading"><h3>{t('claimType')}</h3></div>
        {(['ORGANIC', 'NUTRITION'] as const).map((kind) => <div key={kind} className="claim-row">
          <strong>{t(kind === 'ORGANIC' ? 'organic' : 'nutrition')}</strong>
          <Field label={t('claimText')}><input value={claims[kind].textEn}
            onChange={(event) => setClaims({ ...claims, [kind]: { ...claims[kind], textEn: event.target.value } })} /></Field>
          <Field label={t('evidence')}><input type="url" placeholder="https://" value={claims[kind].evidenceRef}
            onChange={(event) => setClaims({ ...claims, [kind]: { ...claims[kind], evidenceRef: event.target.value } })} /></Field>
        </div>)}</div>
      <label className="checkbox-field"><input type="checkbox" checked={active}
        onChange={(event) => setActive(event.target.checked)} />{t('active')}</label>
      <div className="form-actions"><button className="button primary" type="submit" disabled={!categoryId}>
        {editing ? t('save') : t('create')}</button></div>
    </form></div>;
}

function VariantPanel({ catalog, locale, t, run }: { catalog: Catalog; locale: Locale; t: T; run: RunAction }) {
  const [productId, setProductId] = useState(catalog.products[0]?.id ?? '');
  const [weight, setWeight] = useState('');
  const [riceAge, setRiceAge] = useState('');
  const [evidenceRef, setEvidenceRef] = useState('');
  useEffect(() => { if (!productId && catalog.products[0]) setProductId(catalog.products[0].id); }, [catalog.products, productId]);
  const product = catalog.products.find((entry) => entry.id === productId);
  const isRice = catalog.categories.find((entry) => entry.id === product?.categoryId)?.kind === 'RICE';
  async function submit(event: FormEvent) {
    event.preventDefault();
    const success = await run(() => api('/admin/variants', 'POST', {
      productId, weightGrams: Number(weight), riceAge: isRice ? riceAge : null,
      evidenceRef: isRice ? evidenceRef : null,
    }), 'created');
    if (success) { setWeight(''); setRiceAge(''); setEvidenceRef(''); }
  }
  return <div className="catalog-layout"><div className="panel list-panel"><div className="panel-title"><h2>{t('variants')}</h2>
    <span className="count-badge">{catalog.variants.length}</span></div>
    {catalog.variants.length === 0 && <p className="empty-copy">{t('noVariants')}</p>}
    {catalog.variants.map((variant) => <div className="catalog-list-item static" key={variant.id}>
      <span className="item-monogram">{Math.round(variant.weightGrams / 1000)}k</span>
      <span><strong>{displayName(catalog, catalog.products.find((entry) => entry.id === variant.productId)!, 'productId', locale)}</strong>
        <small>{variant.weightGrams}g{variant.riceAge ? ` · ${variant.riceAge}` : ''}</small></span></div>)}
    </div><form className="panel form-panel" onSubmit={(event) => { void submit(event); }}>
      <div className="panel-title"><h2>{t('addVariant')}</h2></div>
      <div className="form-grid"><Field label={t('product')}><select required value={productId}
        onChange={(event) => setProductId(event.target.value)}><option value="">{t('select')}</option>
        {catalog.products.map((entry) => <option key={entry.id} value={entry.id}>{entry.nameEn}</option>)}</select></Field>
        <Field label={t('weight')}><input type="number" min="1" required value={weight}
          onChange={(event) => setWeight(event.target.value)} /></Field>
        {isRice && <><Field label={t('riceAge')}><input required value={riceAge}
          onChange={(event) => setRiceAge(event.target.value)} /></Field>
          <Field label={t('ageEvidence')}><input type="url" required placeholder="https://" value={evidenceRef}
            onChange={(event) => setEvidenceRef(event.target.value)} /></Field></>}</div>
      <div className="form-actions"><button className="button primary" type="submit" disabled={!productId}>{t('create')}</button></div>
    </form></div>;
}

function OfferRow({ catalog, variant, offer, locale, storeId, t, run }: {
  catalog: Catalog; variant: Variant; offer: Offer | undefined; locale: Locale; storeId: string; t: T; run: RunAction;
}) {
  const product = catalog.products.find((entry) => entry.id === variant.productId)!;
  const [price, setPrice] = useState(offer?.priceInr ?? '');
  const [stock, setStock] = useState((offer?.stockOnHand ?? 0).toString());
  const [active, setActive] = useState(offer?.active ?? false);
  const [reason, setReason] = useState('');
  useEffect(() => { setPrice(offer?.priceInr ?? ''); setStock((offer?.stockOnHand ?? 0).toString());
    setActive(offer?.active ?? false); setReason(''); }, [offer, storeId]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const success = await run(() => api(`/admin/stores/${storeId}/offers/${variant.id}`, 'PUT', {
      priceInr: price, stockOnHand: Number(stock), active, reason,
    }));
    if (success) setReason('');
  }
  return <form className="offer-row" onSubmit={(event) => { void submit(event); }}>
    <div className="offer-product"><span className="item-monogram">{product.nameEn.charAt(0)}</span><span>
      <strong>{displayName(catalog, product, 'productId', locale)}</strong>
      <small>{variant.weightGrams}g{variant.riceAge ? ` · ${variant.riceAge}` : ''}</small></span></div>
    <Field label={t('price')}><input type="number" min="0" step="0.01" required value={price}
      onChange={(event) => setPrice(event.target.value)} /></Field>
    <Field label={t('stock')}><input type="number" min={offer?.stockReserved ?? 0} required value={stock}
      onChange={(event) => setStock(event.target.value)} />
      {Boolean(offer?.stockReserved) && <small>{offer!.stockReserved} {t('reserved')}</small>}</Field>
    <label className="checkbox-field offer-check"><input type="checkbox" checked={active}
      onChange={(event) => setActive(event.target.checked)} />{t('active')}</label>
    <Field label={t('stockReason')}><input value={reason} onChange={(event) => setReason(event.target.value)} /></Field>
    <button type="submit" className="button secondary">{t('updateOffer')}</button>
  </form>;
}

function OffersPanel({ catalog, store, locale, t, run }: {
  catalog: Catalog; store: Store | undefined; locale: Locale; t: T; run: RunAction;
}) {
  if (!store) return <p className="empty-copy">{t('completeProfile')}</p>;
  return <div className="panel offers-panel"><div className="panel-title"><div><h2>{t('offers')}</h2>
    <p>{store.name} · {t('catalogIntro')}</p></div><span className="count-badge">{catalog.variants.length}</span></div>
    {catalog.variants.length === 0 && <p className="empty-copy">{t('noVariants')}</p>}
    {catalog.variants.map((variant) => <OfferRow key={`${store.id}:${variant.id}`} catalog={catalog} variant={variant}
      offer={catalog.offers.find((entry) => entry.variantId === variant.id && entry.storeId === store.id)}
      storeId={store.id} locale={locale} t={t} run={run} />)}</div>;
}

function CatalogPage({ catalog, store, locale, t, run }: {
  catalog: Catalog; store: Store | undefined; locale: Locale; t: T; run: RunAction;
}) {
  const [section, setSection] = useState<'categories' | 'products' | 'variants' | 'offers'>('offers');
  return <><div className="page-heading"><div><div className="eyebrow">{t('operations')} / {t('catalog')}</div>
    <h1>{t('sharedCatalog')}</h1><p>{t('catalogIntro')}</p></div><div className="heading-decor">03 <span>/ 04</span></div></div>
    <div className="segment">{(['offers', 'categories', 'products', 'variants'] as const).map((item) =>
      <button key={item} className={section === item ? 'current' : ''} onClick={() => setSection(item)}>{t(item)}</button>)}</div>
    {section === 'offers' && <OffersPanel catalog={catalog} store={store} locale={locale} t={t} run={run} />}
    {section === 'categories' && <CategoryPanel catalog={catalog} locale={locale} t={t} run={run} />}
    {section === 'products' && <ProductPanel catalog={catalog} locale={locale} t={t} run={run} />}
    {section === 'variants' && <VariantPanel catalog={catalog} locale={locale} t={t} run={run} />}</>;
}

function StaffRow({ person, actorId, stores, t, run }: {
  person: Staff; actorId: string; stores: Store[]; t: T; run: RunAction;
}) {
  const [role, setRole] = useState<Role>(person.role);
  const [storeId, setStoreId] = useState(person.storeId);
  const [active, setActive] = useState(person.active);
  const [password, setPassword] = useState('');
  useEffect(() => { setRole(person.role); setStoreId(person.storeId);
    setActive(person.active); setPassword(''); }, [person]);
  async function save(event: FormEvent) {
    event.preventDefault();
    const success = await run(() => api(`/admin/staff/${person.id}`, 'PUT', {
      role, storeId, active, ...(password ? { password } : {}),
    }));
    if (success) setPassword('');
  }
  return <form className="staff-row" onSubmit={(event) => { void save(event); }}>
    <div className="staff-person"><span className="avatar">{person.loginName.slice(0, 1).toUpperCase()}</span>
      <span><strong>{person.loginName}</strong><small>{stores.find((store) => store.id === person.storeId)?.name}</small></span></div>
    <Field label={t('role')}><select value={role} disabled={person.id === actorId}
      onChange={(event) => setRole(event.target.value as Role)}>
      <option value="ADMIN">{t('admin')}</option><option value="STAFF">{t('staff')}</option></select></Field>
    <Field label={t('assignedStore')}><select value={storeId} onChange={(event) => setStoreId(event.target.value)}>
      {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></Field>
    <label className="checkbox-field"><input type="checkbox" checked={active} disabled={person.id === actorId}
      onChange={(event) => setActive(event.target.checked)} />{t('active')}</label>
    <Field label={t('resetPassword')}><input type="password" minLength={12} autoComplete="new-password"
      value={password} onChange={(event) => setPassword(event.target.value)} /></Field>
    <button className="button secondary" type="submit">{t('update')}</button>
  </form>;
}

function TeamPage({ staff, stores, actorId, t, run }: {
  staff: Staff[]; stores: Store[]; actorId: string; t: T; run: RunAction;
}) {
  const [loginName, setLoginName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('STAFF');
  const [storeId, setStoreId] = useState(stores[0]?.id ?? '');
  useEffect(() => { if (!storeId && stores[0]) setStoreId(stores[0].id); }, [stores, storeId]);
  async function add(event: FormEvent) {
    event.preventDefault();
    const success = await run(() => api('/admin/staff', 'POST', { loginName, password, role, storeId }), 'created');
    if (success) { setLoginName(''); setPassword(''); setRole('STAFF'); }
  }
  return <><div className="page-heading"><div><div className="eyebrow">{t('workspace')} / {t('team')}</div>
    <h1>{t('team')}</h1><p>{t('teamIntro')}</p></div><div className="heading-decor">04 <span>/ 04</span></div></div>
    <form className="panel form-panel team-form" onSubmit={(event) => { void add(event); }}>
      <div className="panel-title"><h2>{t('addTeam')}</h2></div>
      <div className="form-grid team-grid"><Field label={t('loginName')}><input required minLength={3}
        autoComplete="off" value={loginName} onChange={(event) => setLoginName(event.target.value)} /></Field>
        <Field label={t('password')}><input type="password" autoComplete="new-password" minLength={12} required
          value={password} onChange={(event) => setPassword(event.target.value)} /></Field>
        <Field label={t('role')}><select value={role} onChange={(event) => setRole(event.target.value as Role)}>
          <option value="STAFF">{t('staff')}</option><option value="ADMIN">{t('admin')}</option></select></Field>
        <Field label={t('assignedStore')}><select required value={storeId} onChange={(event) => setStoreId(event.target.value)}>
          <option value="">{t('select')}</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></Field></div>
      <div className="form-actions"><button type="submit" className="button primary" disabled={!storeId}>{t('create')}</button></div>
    </form>
    <div className="section-heading"><h2>{t('team')}</h2><span className="small-label">{staff.length} {t('staff')}</span></div>
    <div className="panel team-list">{staff.length === 0 && <p className="empty-copy">{t('noTeam')}</p>}
      {staff.map((person) => <StaffRow key={person.id} person={person} actorId={actorId}
        stores={stores} t={t} run={run} />)}</div>
  </>;
}

export function App() {
  const [locale, setLocaleState] = useState<Locale>(() => {
    const saved = localStorage.getItem('grainbasket-locale');
    return saved === 'hi' || saved === 'mr' ? saved : 'en';
  });
  const t = translator(locale);
  const [session, setSession] = useState<Session | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [tab, setTab] = useState<Tab>('overview');
  const [stores, setStores] = useState<Store[]>([]);
  const [catalog, setCatalog] = useState<Catalog>({ categories: [], products: [], variants: [], offers: [],
    translations: [], claims: [], ageEvidence: [] });
  const [staff, setStaff] = useState<Staff[]>([]);
  const [storeId, setStoreId] = useState('');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [refreshCount, setRefreshCount] = useState(0);
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null);
  const [loadError, setLoadError] = useState(false);

  function setLocale(value: Locale) { localStorage.setItem('grainbasket-locale', value); setLocaleState(value); }
  function enter(value: Session) { setCsrf(value.csrfToken); setSession(value); }
  useEffect(() => {
    const unauthorized = () => { setCsrf(null); setSession(null); };
    window.addEventListener('grainbasket:unauthorized', unauthorized);
    api<Session>('/admin/session').then(enter).catch(() => { setCsrf(null); }).finally(() => setInitializing(false));
    return () => window.removeEventListener('grainbasket:unauthorized', unauthorized);
  }, []);

  const reload = useCallback(async () => {
    const [nextStores, nextCatalog, nextStaff] = await Promise.all([
      api<Store[]>('/admin/stores'), api<Catalog>('/admin/catalog'), api<Staff[]>('/admin/staff'),
    ]);
    setStores(nextStores); setCatalog(nextCatalog); setStaff(nextStaff);
    setStoreId((previous) => nextStores.some((store) => store.id === previous) ? previous : (nextStores[0]?.id ?? ''));
    setLoadError(false);
  }, []);
  useEffect(() => {
    if (session) void reload().catch(() => setLoadError(true));
  }, [session, reload]);
  useEffect(() => {
    if (session && storeId) {
      void api<Overview>(`/admin/overview?storeId=${storeId}`).then(setOverview).catch(() => setOverview(null));
    }
  }, [session, storeId, refreshCount]);

  const run: RunAction = async (work, result = 'saved') => {
    try {
      await work(); await reload(); setRefreshCount((count) => count + 1);
      setNotice({ error: false, text: t(result) });
      return true;
    } catch (failure) {
      setNotice({ error: true, text: failure instanceof Error ? failure.message : t('failed') });
      return false;
    }
  };
  async function logout() {
    try {
      await api<void>('/admin/logout', 'POST');
      setCsrf(null); setSession(null); setNotice(null);
    } catch (failure) { setNotice({ error: true, text: failure instanceof Error ? failure.message : t('failed') }); }
  }
  if (initializing) return <div className="loading-screen"><span className="brand-mark">G</span>{t('loading')}</div>;
  if (!session) return <SignIn t={t} locale={locale} setLocale={setLocale} onLogin={enter} />;
  const store = stores.find((entry) => entry.id === storeId);
  const nav: { id: Tab; label: string; icon: string }[] = [
    { id: 'overview', label: t('overview'), icon: '◫' }, { id: 'stores', label: t('stores'), icon: '▤' },
    { id: 'catalog', label: t('catalog'), icon: '▦' }, { id: 'team', label: t('team'), icon: '◉' },
  ];
  return <div className="app-shell"><aside className="sidebar"><div className="brand"><span className="brand-mark">G</span>
    <span>grainbasket<small>STORE OPERATIONS</small></span></div>
    <div className="sidebar-rule" /><div className="sidebar-label">{t('workspace')}</div>
    <nav aria-label={t('workspace')}>{nav.map((item) => <button key={item.id}
      className={`nav-link ${tab === item.id ? 'selected' : ''}`} onClick={() => setTab(item.id)}>
      <span className="nav-icon" aria-hidden>{item.icon}</span>{item.label}<span className="nav-arrow" aria-hidden>→</span>
    </button>)}</nav><div className="sidebar-bottom"><div className="sidebar-store">
      <span className="sidebar-store-icon">{store?.name.charAt(0).toUpperCase() ?? 'G'}</span>
      <span><small>{t('chosenStore')}</small><strong>{store?.name ?? t('noStore')}</strong></span></div>
      <div className="sidebar-version">GRAINBASKET <span>V1.0</span></div></div></aside>
    <div className="main-column"><header className="topbar"><div className="topbar-crumb">GRAINBASKET <span>/</span> {t(tab)}</div>
      <div className="topbar-actions"><label className="store-picker"><span>{t('chosenStore')}</span>
        <select value={storeId} onChange={(event) => setStoreId(event.target.value)}>
          {stores.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
        <LanguageSelect locale={locale} onChange={setLocale} /><span className="topbar-divider" />
        <div className="user-badge" title={`${t('signedInAs')} ${session.admin.loginName}`}>
          {session.admin.loginName.charAt(0).toUpperCase()}</div>
        <button className="logout" onClick={() => { void logout(); }}>{t('logout')}</button></div></header>
      <main className="content">{notice && <div className={`alert floating ${notice.error ? 'error' : 'success'}`} role="status">
        <span>{notice.text}</span><button aria-label={t('cancel')} onClick={() => setNotice(null)}>×</button></div>}
        {loadError ? <div className="panel load-error"><h2>{t('failed')}</h2>
          <button className="button primary" onClick={() => { void reload().catch(() => setLoadError(true)); }}>{t('tryAgain')}</button></div> : <>
          {tab === 'overview' && <OverviewPage t={t} store={store} summary={overview} toStores={() => setTab('stores')} />}
          {tab === 'stores' && <StorePage stores={stores} store={store} t={t} run={run} chooseStore={setStoreId} />}
          {tab === 'catalog' && <CatalogPage catalog={catalog} store={store} locale={locale} t={t} run={run} />}
          {tab === 'team' && <TeamPage staff={staff} stores={stores} actorId={session.admin.id} t={t} run={run} />}
        </>}</main>
      <footer className="page-footer"><span>© GRAINBASKET</span><span>NAGPUR · {t('adminWorkspace').toUpperCase()}</span></footer>
    </div></div>;
}
