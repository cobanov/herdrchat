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
| F4 | ~~kör Enter~~ → `agent prompt --wait` + `agent_prompt_stalled` | **UYGULANDI** | orta | orta | düşük | 0.8.0 |
| F5 | `events.subscribe` ile polling'i bırakmak | **ERTELENDİ**, gerekçe aşağıda | yüksek | yüksek | orta | doğrulanmalı |
| F6 | `pane report-metadata --token` ile sidebar'a model + telefon işareti | **UYGULANDI** | orta | orta | düşük | var |
| F7 | `agent explain --json` — `client.explainAgent()` | **UYGULANDI** | orta | düşük | yok | var |
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

> **2026-08-13:** bugün gönderildi. Copy diagnostics artık bloklu (yoksa
> odaklı) pane için `client.explainAgent()` çağırıyor ve tek satır olarak
> "Agent detection:" satırına koyuyor; host cevap vermezse satır hiç çıkmıyor.

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

### F4 — UYGULANDI: kör Enter öldü

Raporun ilk hâlinde `pane wait-output` ile ekrandan çıkarmayı önermiştim. Daha
iyi bir cevap varmış, `agent prompt --wait`'in kendi `--help`'inde:

> *"When submission starts from a non-working state, `--wait` first requires an
> observed state change within 5000ms; otherwise it returns
> `agent_prompt_stalled`."*

Yani kör Enter'ın **tahmin etmeye** çalıştığı durumu herdr **gözlemleyip adıyla**
bildiriyor. `sendPrompt` artık üç şey döndürüyor — `delivered` / `stalled` /
`unverified` — çünkü çağıran her biri için farklı davranıyor.

`--timeout` bilerek 8000ms, herdr'ın 5000ms tabanının üstünde: help *"a shorter
--timeout returns timeout instead"* diyor, yani kısası teşhis edilebilir bir
stall'ı jenerik bir timeout'a çevirirdi.

`wasWorking` kontrolü duruyor, çünkü help uyarıyor: *"does not track turns: if
the agent is already working, that active turn's completion may match."*

### F5 — ERTELENDİ, ve gerekçesi ölçüldü

`session.snapshot` + `events.subscribe` doğru mimari, ama bizde çözdüğü problem
büyük ölçüde zaten çözülmüş durumda.

Bugünkü gerçek yük: chat listesi 3sn, thread 2sn, **ikisi de `usePollGate` ile
kapılı** — uygulama arka plandaysa veya ekran üstte değilse loop sökülüyor. Yani
aynı anda tek loop çalışıyor ve en kötü hâl ~0.5 komut/sn. #13'ün korktuğu 2/sn
senaryosu artık yok.

Event'e geçmenin **kazancı**: ekran açıkken gecikme 2sn'den ~anlıka iner.
**Maliyeti** üç tane ve hiçbiri küçük değil:

1. SSH akışı sessizce ölür. Polling kendi kendini iyileştiriyor — her tick yeni
   bir komut, bağlantı düşmüşse bir sonraki deniyor. Uzun ömürlü bir abonelik
   düştüğünde ekran donar ve bunu fark edecek bir watchdog yazmak gerekir. Bu
   watchdog'un kendisi de bir poll'dür.
2. Telefon arka plana geçtiğinde aboneliği kapatıp dönüşte snapshot'la yeniden
   kurmak gerekir — `usePollGate`'in bugün bedavaya yaptığı şey.
3. `streamLines` transport'umuzda zaten transcript tail'i için kullanılıyor;
   ikinci uzun ömürlü akış aynı SSH bağlantısında iki ayrı yaşam döngüsü demek.

**Karar: yapılmıyor.** Yeniden değerlendirme tetikleyicisi net — poll'ün gecikmesi
şikâyet konusu olursa, ya da tek bir host'ta aynı anda birden fazla thread
açılabilir hâle gelirse.

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

## 4b. Şablonun ilk turda atladığım bölümleri

**L — Bildirim.** `herdr notification` tek alt komut: `show`. `ui.toast.delivery`
config'imizde `"system"`. Telefon bildirimleri APNs'ten geliyor
(`scripts/herdr-apns-notifier.py`), yani herdr'ın toast'u bizim yolumuzla
**alakasız** — masaüstünde çalışırken görülen şey. Uygulanacak bir şey yok.
Dokümanın `reason` dönüş değerleri ve `delay_seconds` davranışı bu app'e
değmiyor.

**N — Ergonomi ve config.** `terminal.shell_mode = "auto"`, `terminal.new_cwd =
"follow"`, `advanced.scrollback_limit_bytes = 10000000`,
`experimental.allow_nested = false` — hepsi default ve config'imizde yok, yani
implicit. Bunlar **masaüstü ergonomisi**; HerdrChat host'ta pane açmıyor, shell
modu seçmiyor. `experimental.pane_history` bu binary'nin default-config'inde
görünmüyor — **doğrulanmalı**, ama açmak için sebep de yok: ekran geçmişini
diske yazmak, transcript'i zaten okuyan bir kurulumda ikinci bir kopya demek.
`herdr completion zsh` ve `config reset-keys` senin kabuk ergonomin, app'in
değil.

**M — Oturum, socket, remote.** Named session çözümleme sırası
(`--session` > `HERDR_SOCKET_PATH` > `HERDR_SESSION` > default) bizim için
`withSession()` ile kapandı (0.6.2). `herdr --remote` ve `[remote]
manage_ssh_config` **bize uymaz**: onlar bir herdr istemcisini SSH üzerinden
sunucuya bağlıyor, biz zaten kendi SSH transport'umuzu taşıyoruz ve TUI
attach etmiyoruz. `--handoff` canlı devir için, `herdr server` supervised
çalıştırma için — ikisi de host tarafı işletme kararı, app'in değil.

**I — Topoloji.** `worktree` var ve çalışıyor, ama HerdrChat tek seferde tek
sohbet gösteren bir telefon uygulaması; paralel worktree akışı masaüstü işi.
`pane move` cross-workspace var — kullanmıyoruz, çünkü telefondan pane taşımak
için bir sebep yok. `layout export/apply` ne binary'de ne dokümanda.

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
