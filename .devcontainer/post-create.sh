#!/usr/bin/zsh
source $HOME/.zshrc
git clone https://github.com/zsh-users/zsh-autosuggestions.git $ZSH_CUSTOM/plugins/zsh-autosuggestions \
  && git clone https://github.com/zsh-users/zsh-syntax-highlighting.git $ZSH_CUSTOM/plugins/zsh-syntax-highlighting \
  && git clone https://github.com/zdharma-continuum/fast-syntax-highlighting.git ${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}/plugins/fast-syntax-highlighting \
  && git clone --depth 1 -- https://github.com/marlonrichert/zsh-autocomplete.git $ZSH_CUSTOM/plugins/zsh-autocomplete \
  && omz plugin enable  zsh-autosuggestions zsh-syntax-highlighting fast-syntax-highlighting zsh-autocomplete debian bun\
  && omz theme set duellj


# sudo chown -R ${UID}:${UID} /workspace node_modules .pnpm-store
#  && mkdir -p ~/.oh-my-zsh/completions \
#  && pnpm completion zsh > ~/.oh-my-zsh/completions/_pnpm \
#  && echo 'fpath=(~/.oh-my-zsh/completions $fpath)' >> ${HOME}/.zshrc \
#  && echo 'autoload -Uz compinit && compinit' >> ${HOME}/.zshrc
if [ -d "/workspace/package.json" ]; then
  echo "📦 Installing dependencies with Bun..."
  bun install
else
  echo "⚠️ No package.json found in /workspace. Skipping dependency installation."
fi