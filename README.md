# Mão Robótica — Pedra, Papel ou Tesoura 🤖✊✋✌️

Mão robótica feita com **Arduino Uno + 5 micro servos SG90** que imita o
gesto (pedra, papel ou tesoura) mostrado pela sua mão na câmera do
computador. Todo o reconhecimento roda **no navegador** (MediaPipe
HandLandmarker), sem backend — a página é 100% estática e a comunicação com
o Arduino é feita via **Web Serial API** (USB).

## Demonstração

<video src="./demo.mp4" controls width="600">
  Seu navegador não suporta vídeo embutido — baixe em
  <a href="./demo.mp4">demo.mp4</a>.
</video>

Vídeo mostrando a mão robótica reconhecendo os gestos (pedra, papel ou
tesoura) e reagindo em tempo real. Se o player acima não carregar na
visualização do GitHub, baixe/abra direto pelo link
[`demo.mp4`](./demo.mp4).

## Acessar a página (GitHub Pages)

A página é 100% estática e fica na pasta `docs/`:

**https://fernando0da0costa.github.io/m-o-robotica-Joquemp-com-inteligencia-artificial-/**

Abra esse link em **Chrome, Edge ou Opera** no computador conectado ao
Arduino por USB — HTTPS satisfaz o contexto seguro exigido pela câmera e
pela Web Serial API.

> ⚠️ **Se esse link mostrar este README em vez do app**, é porque o GitHub
> Pages ainda não está configurado para publicar a pasta `docs/`. Corrija
> em: **Settings → Pages → Build and deployment → Source → "Deploy from a
> branch"**, e logo abaixo escolha **Branch: `main`** e **Folder: `/docs`**
> (essas são as únicas duas opções que o GitHub oferece nesse modo — raiz do
> repo ou `/docs` — por isso o projeto usa `docs/` em vez de `web/`). Salve;
> em 1–2 minutos o link acima passa a abrir o app.

## Como funciona

```
[Câmera do PC] → MediaPipe HandLandmarker → Classificador de gesto
                                                     |
                                     Web Serial API (USB, 115200 bps)
                                                     |
                                          [Arduino Uno + Servo.h]
                                                     |
                          5x SG90 (polegar, indicador, médio, anelar, mindinho)
```

1. A câmera captura sua mão e o MediaPipe detecta os 21 pontos (landmarks).
2. Um classificador por regras geométricas decide o gesto: pedra, papel ou
   tesoura.
3. O navegador envia comandos pela porta serial USB para o Arduino, que
   aciona os 5 servos.
4. Todos os parâmetros de calibração ficam salvos no `localStorage` do
   navegador — não precisa reprogramar o Arduino para ajustar.

Para os detalhes técnicos completos (protocolo serial, ligações elétricas,
classificação do gesto, decisões de arquitetura), veja
[`PLANEJAMENTO.md`](./PLANEJAMENTO.md).

## Requisitos

- **Arduino Uno** + 5 servos **SG90** (posicionais 180° **ou** de rotação
  contínua 360° — o firmware tem uma versão para cada, veja abaixo).
- Fonte externa **5V (mín. 2A)** para os servos — **não** alimente os 5
  servos pelo 5V do Arduino (causa brownout/reset). GND comum entre a fonte
  externa e o Arduino.
- Navegador **Google Chrome, Edge ou Opera** no desktop (a Web Serial API
  **não** funciona no Firefox nem no Safari).
- Página servida via `http://localhost` ou `https://` (abrir o `index.html`
  direto com duplo-clique pode não funcionar, pois câmera e Web Serial
  exigem contexto seguro).

## Ligações (wiring)

| Dedo | Pino Arduino |
|---|---|
| Polegar | D3 |
| Indicador | D5 |
| Médio | D6 |
| Anelar | D9 |
| Mindinho | D10 |

Fios vermelhos (V+) dos servos → fonte externa 5V. Fios marrons/pretos (GND)
→ GND da fonte externa **e** GND do Arduino. Um capacitor de 470–1000 µF
entre + e - perto dos servos ajuda a absorver o pico de corrente.

## Como usar

### 1. Gravar o firmware no Arduino

Escolha a versão de acordo com o seu servo:

- `firmware/rps_hand_firmware_360/rps_hand_firmware_360.ino` — servos de
  **rotação contínua** (360°), controlados por pulso cronometrado contra um
  batente mecânico.
- `firmware/rps_hand_firmware_180/rps_hand_firmware_180.ino` — servos
  **posicionais comuns** (180°), controlados por ângulo direto.

Abra o `.ino` correspondente na Arduino IDE, selecione a placa "Arduino Uno"
e a porta serial, e grave.

### 2. Subir a página web

**Opção A — Docker + nginx (recomendado):**

```bash
cd rps_hand
docker compose up -d --build
```

Abre em `http://localhost:8081`. Para parar: `docker compose down`. Para ver
logs: `docker compose logs -f`.

**Opção B — servidor Python (sem Docker):**

```bash
cd rps_hand/docs
python3 -m http.server 8080
```

Abre em `http://localhost:8080`.

Em ambos os casos, abra em **Chrome ou Edge**, no computador que está
fisicamente conectado ao Arduino por USB.

### 3. Conectar e calibrar

1. Clique em **"Conectar Arduino"** e escolha a porta serial.
2. Clique em **"Iniciar câmera"** e permita o acesso.
3. Na aba **Calibração**, selecione o tipo de servo (180° ou 360°) e ajuste
   os valores de cada dedo até a mão abrir/fechar corretamente. Use os
   botões **"Testar"** para mover um servo por vez. Clique em **"Salvar
   calibração"** — os valores ficam guardados no navegador.
4. Na aba **Operação**, use os botões **Zero / Pedra / Papel / Tesoura**
   para testar os gestos manualmente, sem precisar da câmera.

### 4. Jogar

Mostre pedra ✊, papel ✋ ou tesoura ✌️ para a câmera — a mão robótica
reproduz o gesto, sempre passando pela posição zero entre um gesto e outro.

## Publicar no GitHub Pages

O site estático mora em `docs/` (com um `.nojekyll` para o GitHub não tentar
processar os arquivos com Jekyll). O modo "Deploy from a branch" do GitHub
Pages só aceita publicar a raiz do repositório **ou** uma pasta `/docs` —
por isso o projeto usa `docs/` em vez de `web/`.

Passos (uma vez só):
1. Dar push deste projeto para a branch `main`.
2. No repositório: **Settings → Pages → Build and deployment → Source →
   "Deploy from a branch"**.
3. Em **Branch**, escolher `main` e a pasta **`/docs`**, depois **Save**.

Em 1–2 minutos o site sobe em
`https://fernando0da0costa.github.io/m-o-robotica-Joquemp-com-inteligencia-artificial-/`.
GitHub Pages serve tudo via HTTPS, então câmera e Web Serial funcionam
normalmente — a única exigência é abrir a página em Chrome/Edge no
computador com o Arduino ligado na USB.

## Estrutura do projeto

```
rps_hand/
├── README.md
├── PLANEJAMENTO.md                  # detalhes técnicos completos
├── demo.mp4                         # vídeo de demonstração
├── docker-compose.yml               # sobe o nginx local (porta 8081)
├── firmware/
│   ├── rps_hand_firmware_180/       # firmware para servos posicionais (180°)
│   └── rps_hand_firmware_360/       # firmware para servos de rotação contínua (360°)
└── docs/                            # site estático, também servido pelo GitHub Pages
    ├── .nojekyll                    # evita que o GitHub Pages processe os arquivos com Jekyll
    ├── index.html                   # UI + conexão + calibração
    ├── style.css
    ├── app.js                       # câmera, MediaPipe, classificador, Web Serial
    ├── Dockerfile
    ├── nginx.conf
    └── .dockerignore
```

## Limitações conhecidas

- Web Serial exige Chrome/Edge/Opera desktop; sem suporte em Firefox/Safari
  estáveis nem na maioria dos navegadores mobile.
- Iluminação ruim ou mão parcialmente fora do quadro reduz a precisão da
  detecção.
- O classificador é baseado em regras geométricas simples — funciona bem
  para os 3 gestos clássicos, mas não é um classificador de propósito geral.
- Cada aba do navegador só mantém uma conexão serial por vez com a porta; é
  preciso desconectar antes de abrir o Serial Monitor da Arduino IDE, por
  exemplo.
