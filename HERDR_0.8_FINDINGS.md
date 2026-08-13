# Herdr 0.8.0 — doküman incelemesi ve mevcut kurulum analizi

**Tarih:** 2026-08-13
**Kurulu sürüm:** `herdr 0.8.0` (bu incelemede 0.7.4'ten yükseltildi) (`/Users/cobanov/.local/bin/herdr`, ayrıca `/opt/homebrew/bin/herdr`)
**Protokol:** 19, `schema_version` 1 (yükseltmeden önce 16)
**Doküman sürümü:** 0.8.0

> ## ⚠️ Bu rapor 0.7.4'e karşı yazıldı, sonra host 0.8.0'a yükseltildi
>
> **F1 ve F2 yanlış alarmdı.** İkisini de "yüksek risk" diye işaretlemiştim;
> 0.8.0 kurulunca ölçtüm ve gönderilen kodun **doğru** olduğu çıktı. Aşağıda
> düzeltmesi var. Raporun geri kalanı geçerli.
>
> Ayrıca `herdr agent --help` formatı 0.8.0'da tamamen değişti (clap tarzı), yani
> F1'de önerdiğim regex de yanlıştı — uygulanmadı, gerek kalmadı.

## BAĞLAM — template boş geldi

İstenen bağlam alanları (`<DOLDUR>`) doldurulmamıştı ve template "varsayım yapma"
diyor. Aşağıdakini **varsayımla değil, bu repodan ve oturum kanıtından** çıkardım;
yanlışsa düzelt, çünkü D ve M bölümleri buna dayanıyor:

| Alan | Kanıttan çıkan |
|---|---|
| Ne için | HerdrChat — telefondan Claude Code agent'ı sürmek (`CLAUDE.md`) |
| Bağlantı | SSH over Tailscale, CLI polling (`src/lib/herdr/sshTransport.ts`, `useWorkspaces.ts` 3sn / `useThread.ts` 2sn) |
| Repo | `/Users/cobanov/Developer/herdrchat` |
| Config | `~/.config/herdr/config.toml` (345 bayt, aşağıda) |

**Doldurman gerekenler:** uzak host'larda (spark vb.) hangi herdr sürümü kurulu?
Bu raporun en kritik bulgusu buna bağlı — aşağıda F1.

---

## 1. Özet tablo

| # | Bulgu | Kategori | Etki | Efor | Risk | Sürüm |
|---|---|---|---|---|---|---|
| ~~F1~~ | ~~Capability probe bozuk~~ — **YANLIŞ ALARM**, aşağıda | BILGI | — | — | yok | çözüldü |
| ~~F2~~ | ~~`agent start` imzası uyuşmuyor~~ — **YANLIŞ ALARM** | BILGI | — | — | yok | çözüldü |
| **F14** | **Sürüm snapshot'ta zaten geliyordu, hiç okunmuyordu** | **OPTIMIZASYON** | orta | düşük | düşük | uygulandı |
| F3 | `agent prompt` artık host'ta VAR (0.8.0) — #10 devrede | BILGI | orta | — | yok | çözüldü |
| F4 | `pane wait-output` var, kullanmıyoruz — kör Enter hâlâ orada | OPTIMIZASYON | orta | orta | düşük | 0.8.0'da var |
| F5 | `events.subscribe` ile polling'i bırakmak | OPTIMIZASYON | yüksek | yüksek | orta | doğrulanmalı |
| F6 | `pane report-metadata --token` ile sidebar'a model/görev yansıtmak | YENI_YETENEK | orta | orta | düşük | var |
| F7 | `agent explain --json` teşhis için, hiç kullanmıyoruz | OPTIMIZASYON | orta | düşük | yok | var |
| F8 | `[session] resume_agents_on_restore` (default true) — config'imizde implicit | BILGI | orta | — | yok | doğrulanmalı |
| F9 | Claude "session identity", "lifecycle authority" değil — state ekran tespitinden | BILGI | yüksek | — | yok | 0.8.0 dokümanı |
| F10 | Named session'a otomasyonu izole etmek | OPTIMIZASYON | düşük | düşük | düşük | var, 0.6.2'de yapıldı |
| **F15** | **Doküman `plugin` var diyor, 0.8.0 stable binary'de YOK** | BILGI | düşük | — | — | doküman ≠ binary |
| F12 | `terminal session observe/control` 0.8.0 binary'de de yok; `agent attach --takeover` var | BILGI | düşük | — | — | doküman ≠ binary |
| F13 | `layout export/apply` dokümanda da yok | BILGI | — | — | — | yok |

---

## 2. Hemen uygula

### F1 + F2 — DÜZELTME: ikisi de yanlış alarmdı

0.8.0 kurulduktan sonra ölçtüğüm gerçek davranış:

| Komut | 0.7.4 | 0.8.0 |
|---|---|---|
| `herdr agent prompt --help` | exit 2 | exit **0** |
| `herdr agent start --help` | exit 2 | exit **0** |
| `herdr agent zzzbogus --help` | exit 2 | exit **2** |

**Probe 0.8.0'da doğru ayırt ediyor** ve server çalışmıyorken bile öyle. 0.7.4'te
ise her fiile 2 döndüğü için hep `false` diyordu — yani **fail-closed**, legacy
path'e düşüyordu. Yani gönderilen kod her iki sürümde de doğru davranıyordu.

İki iddiam yanlıştı:
- *"0.8.0'da bile ölü doğar"* → **yanlış**, 0.8.0'da exit 0.
- *"0.7.4 host'ta yeni sohbet kırılır"* → **tetiklenmiyor**, probe zaten false diyordu.

İmza tahminlerim ise birebir tutuyor:

```
0.8.0: herdr agent prompt <TARGET> <TEXT> [--wait] [--until STATUS] [--timeout MS]
0.8.0: herdr agent start <NAME> --kind <KIND> --pane <ID> [--timeout MS] [-- ARGS]
```

`--kind` kabul edilen değerler arasında `claude` var. Kodun gönderdiği tam bu.

### F14 — Sürüm kontrolü (uygulandı)

Probe'un asıl sorunu doğruluk değil, **gereksizlik**: `snapshot.version` alanı
`models.ts`'te en başından beri decode ediliyordu ve **hiçbir yer okumuyordu**.
Host zaten her poll'de sürümünü söylüyorken `--help` için ayrı bir SSH
round-trip'i harcıyorduk.

Eklenenler:
- `src/lib/herdr/version.ts` — saf: `parseVersion`, `atLeast`, `versionVerdict`
  (`current` / `legacy` / `unsupported` / `unknown`), `versionAdvice`
- `client.snapshot()` sürümü hatırlıyor; capability kapıları önce ona bakıyor,
  probe sadece sürüm bildirmeyen host'lar için fallback olarak kalıyor
- Settings → About'ta **"herdr on host"** satırı; eski sürümde `⚠︎` ve ne
  yapılacağını söyleyen bir footer
- Copy diagnostics artık host'un herdr sürümünü de taşıyor

24 test. Sayısal karşılaştırma, çünkü string karşılaştırma `"0.10.0" < "0.8.0"`
der.

### F7 — `agent explain --json`'ı teşhis yoluna ekle (~10 dk)

0.7.4'te **var** ve hiç kullanmıyoruz. Bugün agent durumu yanlış göründüğünde
elimizde sadece `agentStatus` var. `agent explain` tespitin *neden* öyle olduğunu
söylüyor.

Settings → Copy diagnostics içine tek satır eklemek yeterli (şu an `lastError:
null` bırakılmış yer):

```bash
herdr agent explain <target> --json
```

### F10 — Otomasyonu named session'a izole et (~5 dk, config değişikliği yok)

Çözümleme sırası: `--session` > `HERDR_SOCKET_PATH` > `HERDR_SESSION` > default.
0.6.2'de `withSession()` transport'a bağlandı, yani host editöründe bir isim
yazmak yeterli — kod değişikliği gerekmiyor. Telefonun sürdüğü oturumu masaüstünde
elle kullandığından ayırmak istiyorsan alan zaten orada.

---

## 3. Değerlendirilmeli

### F4 — `herdr wait output` ile sleep+read döngüsünü değiştir

**Mevcut** (`src/features/thread/useThread.ts`, `deliver`):

```ts
let accepted = await client.waitAgentStatus(pane.paneId, 'working', 3500);
if (!accepted) {
  await client.sendKeys(pane.paneId, ['Enter']);   // kör Enter
  accepted = await client.waitAgentStatus(pane.paneId, 'working', 2500);
}
```

`waitAgentStatus` zaten `herdr wait agent-status`'a gidiyor — bu **iyi**, polling
değil. Ama kör Enter hâlâ orada (0.6.2'de sadece `agent prompt` varsa devre dışı
kalıyor, ki 0.7.4'te yok).

0.7.4'te **bugün** kullanılabilecek şey: `herdr wait output <pane> --match <text>
[--regex]`. Kör Enter'ın çözmeye çalıştığı "prompt composer'da takılı kaldı"
durumu, ekranda prompt'un görünüp görünmediğine bakılarak ayırt edilebilir —
körlemesine Enter yollamak yerine.

**Taşınma:** `client.ts`'e `waitOutput(paneId, match, {regex, timeoutMs})` ekle,
`deliver`'da kör Enter'ı "ekranda gönderdiğimiz metin duruyor mu" kontrolüyle
değiştir. Ölçülmeden yapılmamalı — `--source visible` semantiği doğrulanmalı.

### F5 — `events.subscribe` ile polling'i bırakmak

Bugün: chat listesi 3sn, thread 2sn, ikisi de `usePollGate` ile kapılı (aynı anda
sadece biri çalışıyor). Yani en kötü hâl ~0.5 komut/sn, #13'te korkulan 2/sn değil.

0.8.0 dokümanı `session.snapshot` + `events.subscribe` ile incremental cache
öneriyor; event listesi geniş (`pane.agent_status_changed`, `pane.output_matched`,
`workspace.metadata_updated`, `layout.updated`, `worktree.*`).

**Bize uyar mı — açık soru.** Transport'umuz `exec` (tek atışlık komut) ve
`streamLines` (uzun ömürlü). `events.subscribe` ikincisine oturur, ama:
- SSH bağlantısı düştüğünde event akışı sessizce ölür; polling kendi kendini iyileştirir.
- Telefon arka plana geçtiğinde akışı kapatıp snapshot'la yeniden başlamak gerekir.
- `usePollGate` bugün bunu bedavaya çözüyor.

Kazanç, ekran açıkken gecikmenin 2sn'den ~anlıka inmesi. Bu gerçek bir UX kazancı
ama mimari değişiklik. **Önce F1/F2 kapansın.**

### F6 — Sidebar'a agent metadata yansıtmak

`pane report-metadata` 0.7.4'te **tam bayrak setiyle var**: `--token NAME=VALUE`,
`--ttl-ms`, `--seq`, `--state-label STATUS=TEXT`, `--display-agent`.
`ui.sidebar.agents.rows` default `[["state_icon","workspace","tab"],["agent"]]`,
ve `rows_by_agent` ile agent bazlı override var.

**Somut tasarım.** HerdrChat zaten transcript'ten model adını okuyor
(`modelDisplayName`, thread başlığında gösteriliyor). Aynı değeri host'a geri
yazabiliriz:

```bash
herdr pane report-metadata "$PANE" \
  --source herdrchat \
  --token model="Opus 5" \
  --token phone="on" \
  --ttl-ms 30000 --seq "$N"
```

config (öneri, uygulanmadı):

```toml
[ui.sidebar.agents]
rows = [["state_icon", "workspace", "tab"], ["agent", "$model"], ["$phone"]]
```

Faydası: masaüstünde sidebar'a bakınca hangi agent'ın telefondan sürüldüğü ve
hangi modelde olduğu görünür. `--ttl-ms` sayesinde telefon susarsa etiket kendi
kendine düşer — bayat veri kalmaz.

**Maliyet:** her poll'de bir ekstra komut. `--ttl-ms 30000` ile 30sn'de bir
yetiyor, yani poll'e bağlamak yerine ayrı ve seyrek bir yazım olmalı.

---

## 4. Uygulanmaz

| Konu | Neden |
|---|---|
| **`plugin` sistemi (J)** | **Doküman var diyor, binary'de yok.** `herdr 0.8.0 --help` alt komut listesinde `plugin` geçmiyor (0.7.4'te de yoktu). `~/.config/herdr/plugins/` ve `plugins.json` var ama CLI yüzeyi yok — muhtemelen preview kanalında. Ayrıca tekrarlayan manuel işimiz zaten yok; ship akışı `scripts/testflight.sh` ile otomatik. |
| **`terminal session observe/control` (E)** | 0.8.0 binary'de de `terminal` alt komutu yok (doküman var diyor). Karşılığı `agent attach [--takeover]`. Zaten SSH tünelimiz çalışıyor ve telefonda ANSI frame render etmek istemiyoruz — CLAUDE.md'nin tüm mimarisi "terminal görüntüleyici olma, mesaj render et" üzerine kurulu. |
| **`layout export/apply` (I)** | Ne 0.7.4'te ne de 0.8.0 CLI dokümanında var. İstek listesinde geçiyor ama kaynak yok. |
| **Worktree tabanlı paralel akış (I)** | `worktree` 0.7.4'te var, ama HerdrChat tek seferde tek sohbet gösteren bir telefon uygulaması. Paralel worktree'ler masaüstü iş akışı; telefonda karşılığı yok. |
| **Kendi custom entegrasyonumuzu yazmak (G)** | Claude entegrasyonu `current (v7)`, doküman minimum **6** diyor — üstündeyiz. Kendi entegrasyonumuz `agent_session.value`'yu zaten üreten şeyi yeniden yazmak olurdu. |
| **Kendi kısaltılmış skill dosyamız (O)** | Bu repo herdr'ı *kullanan* bir uygulama, herdr'ı süren bir agent değil. Claude Code'un burada herdr CLI bilmesi gerekmiyor; bilmesi gereken `CLAUDE.md`'de zaten var. 0.8.0'da `herdr --skill` bayrağı geldi — host üzerinde çalışan agent'lar için anlamlı, bu repo için değil. |
| **`agent prompt` (F3)** | 0.7.4'te yok. Kod 0.6.2'de yazıldı ve fallback ile korumalı; 0.8.0'a çıkınca **kendiliğinden** devreye girer (F1 düzeltilirse). Bugün yapılacak bir şey yok. |

---

## 5. Açık sorular — senin cevaplaman gerekenler

1. ~~Uzak host sürümü~~ — **cevaplandı**: bu cihaz host kabul edildi, 0.8.0'a
   yükseltildi. Başka host eklersen `herdr on host` satırı sürümünü gösterecek.

2. ~~Olmayan fiilin `--help`'i~~ — **cevaplandı**: 0.8.0'da exit 2, doğru ayırt
   ediyor.

3. ~~0.8.0'a yükseltelim mi?~~ — **yapıldı.** `herdr update` var, kanal `stable`. Kazanç:
   `agent prompt --wait` (gömülü wait, tek round-trip), `agent wait --until`
   (çoklu durum), `pane wait-output`, `plugin`, `terminal session observe`.
   Maliyet: entegrasyon minimumları değişebilir (`herdr integration status
   --outdated-only` ile önden bak).

4. **F6'daki sidebar tasarımı isteniyor mu?** Faydası masaüstünde görünürlük;
   maliyeti periyodik bir ekstra yazım. Kullanmıyorsan yapmayalım.

5. **`ui.toast.delivery = "system"` bilinçli mi?** Config'inde öyle. Doküman
   `off|herdr|terminal|system` diyor ama SSH üzerinden hangisinin çalıştığını
   yazmıyor — **doğrulanmalı**. Telefon bildirimleri APNs'ten geldiği için
   muhtemelen alakasız, ama masaüstü davranışını sen biliyorsun.

---

## Ek: bu makinede ölçülenler

```
herdr 0.7.4 · protocol 16 · schema_version 1 · channel stable
server: not running · socket ~/.config/herdr/herdr.sock

integration status:
  claude:  current (v7)   ~/.claude/hooks/herdr-agent-state.sh   [doküman min: 6]
  codex:   current (v6)   ~/.codex/herdr-agent-state.sh          [doküman min: 5]
  diğer 12 entegrasyon: not installed

config.toml (345 B): onboarding=false, theme.name="terminal",
  ui.toast.delivery="system", ui.show_agent_labels_on_pane_borders=true,
  keys.switch_workspace="prefix+1..9", keys.switch_tab="prefix+shift+1..9"

0.7.4'te VAR : agent {list,get,read,send,rename,focus,wait,attach,start,explain}
               pane {…,report-agent,report-agent-session,release-agent,report-metadata,run,move}
               wait {output,agent-status} · worktree · notification · session · api · integration
0.7.4'te YOK : agent prompt · plugin · terminal · layout · pane wait-output (adı: wait output)
imza farkı   : agent start (--kind/--pane/--timeout yok) · agent wait (--status, --until değil)
```

**Kaynaklar:** [cli-reference](https://herdr.dev/docs/cli-reference/) ·
[socket-api](https://herdr.dev/docs/socket-api/) ·
[config-reference](https://herdr.dev/docs/config-reference/) ·
[integrations](https://herdr.dev/docs/integrations/)
