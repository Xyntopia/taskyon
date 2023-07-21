import { defineStore } from 'pinia';

export const useWriterSettingsStore = defineStore('writerSettings', {
  state: () => {
    console.log('initialize writer settings');
    return {
      objective: '',
    };
  },
});
