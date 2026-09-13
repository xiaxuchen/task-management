#!/bin/bash
# Layout Manager IDEA 插件构建：javac（IDEA 自带 JBR 25）直接编译，jar 打包
# 无需 Gradle / 网络依赖；classpath 使用本地 IDEA 安装目录的 lib
set -e
cd "$(dirname "$0")"

IDEA_APP="${IDEA_APP:-/Applications/IntelliJ IDEA.app}"
JBR="$IDEA_APP/Contents/jbr/Contents/Home"
LIBDIR="$IDEA_APP/Contents/lib"

if [ ! -x "$JBR/bin/javac" ]; then
  echo "未找到 IDEA 自带 JDK：$JBR" >&2
  exit 1
fi

rm -rf out dist
mkdir -p out dist/layout-manager/lib

CP=$(find "$LIBDIR" -name "*.jar" | tr '\n' ':')
echo "编译（javac: $("$JBR/bin/javac" -version 2>&1)，classpath: $(find "$LIBDIR" -name '*.jar' | wc -l | tr -d ' ') 个 jar）..."

find src -name "*.java" > /tmp/xp-layout-sources.txt
"$JBR/bin/javac" -encoding UTF-8 --release 17 -cp "$CP" -d out @/tmp/xp-layout-sources.txt
echo "编译通过 ✓"

cp -r resources/* out/
(cd out && jar cf "../dist/layout-manager/lib/layout-manager.jar" .)

PLUGIN_DIR="$HOME/Library/Application Support/JetBrains/IntelliJIdea2026.2/plugins"
echo
echo "构建完成：dist/layout-manager/lib/layout-manager.jar"
echo "安装（重启 IDEA 生效）："
echo "  cp -r dist/layout-manager \"$PLUGIN_DIR/\""
