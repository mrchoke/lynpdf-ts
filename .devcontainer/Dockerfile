# ──────────────────────────────────────────────────────────────────────────────
# LynPDF Dev Container
#
# Base: Ubuntu 24.04 (Noble) — slim variant
# Runtime: Bun (latest stable) + Node.js 20 LTS (fallback / tool compat)
#
# All HarfBuzz shaping and Yoga layout run as pure WASM bundled inside
# node_modules — NO libharfbuzz-dev, libfontconfig-dev, or build-essential
# are required at runtime.  We only install the bare minimum system tools
# needed for a productive dev environment.
# ──────────────────────────────────────────────────────────────────────────────

FROM ubuntu:24.04

# Prevent apt from prompting for timezone / locale during install
ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=Asia/Bangkok

# ── System packages ────────────────────────────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
  # Core tools
  curl \
  wget \
  unzip \
  git \
  ca-certificates \
  gnupg \
  # Shell convenience
  bash \
  zsh \
  less \
  jq \
  # Required by pdfkit for some image handling (optional but recommended)
  libpng-dev \
  libjpeg-dev \
  # Required by fontkit / harfbuzzjs WASM on older kernels (libatomic)
  libatomic1 \
  # Locale support (for Intl.Segmenter th-TH)
  locales \
  # Process tools
  procps \
  && locale-gen en_US.UTF-8 th_TH.UTF-8 \
  && update-locale LANG=en_US.UTF-8 \
  && rm -rf /var/lib/apt/lists/*

ENV LANG=en_US.UTF-8
ENV LC_ALL=en_US.UTF-8

# ── Node.js 20 LTS (via NodeSource) ──────────────────────────────────────────
# Needed by some VS Code extensions and as an npm/pnpm fallback.
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
  && apt-get install -y nodejs \
  && rm -rf /var/lib/apt/lists/* \
  && node --version && npm --version

# ── Bun (latest stable) ───────────────────────────────────────────────────────
ENV BUN_INSTALL=/usr/local
RUN curl -fsSL https://bun.sh/install | bash \
  && bun --version

# ── pnpm / yarn (optional package manager alternatives) ──────────────────────
RUN npm install -g pnpm yarn --quiet

# ── Create non-root user ─────────────────────────────────────────────────────
ARG USERNAME=dev
ARG USER_UID=1000
ARG USER_GID=1000

RUN groupadd --gid ${USER_GID} ${USERNAME} \
  && useradd --uid ${USER_UID} --gid ${USER_GID} -m -s /usr/bin/zsh ${USERNAME} \
  && apt-get update \
  && apt-get install -y --no-install-recommends sudo \
  && echo "${USERNAME} ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers.d/${USERNAME} \
  && chmod 0440 /etc/sudoers.d/${USERNAME} \
  && rm -rf /var/lib/apt/lists/*

# Install Oh My Zsh for the dev user (optional quality-of-life)
USER ${USERNAME}
RUN sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)" "" --unattended || true

USER root

WORKDIR /workspace
