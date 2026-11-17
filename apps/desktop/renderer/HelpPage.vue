<script setup lang="ts">
import { ref,onMounted } from 'vue';import { ElButton } from 'element-plus';import { readStaticHelp,helpTopics } from '../../../packages/contracts/help.ts';
const query=ref(''),items=ref<Array<{id:string;title:string;text:string}>>([...helpTopics]);function search(){items.value=query.value.trim()?(readStaticHelp('help.search',{query:query.value.trim()}) as {items:typeof items.value}).items:[...helpTopics];}onMounted(search);
</script>
<template><section class="panel"><h2>包内使用说明</h2><p class="muted">离线可读；这些说明不代表当前宿主已连接，也不返回任何业务缓存。</p><div class="search-row"><input v-model="query" aria-label="搜索使用说明" maxlength="80" placeholder="配对、额度、诊断、导出…" @keyup.enter="search" /><ElButton @click="search">搜索说明</ElButton></div></section><article v-for="item in items" :key="item.id" class="panel"><h2>{{ item.title }}</h2><p>{{ item.text }}</p></article><p v-if="!items.length" class="muted">没有匹配的包内说明。</p></template>
