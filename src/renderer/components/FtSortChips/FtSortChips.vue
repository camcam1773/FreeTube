<template>
  <div class="sort-chips">
    <button
      v-for="(name, index) in selectNames"
      :key="selectValues[index]"
      class="sort-chip"
      :class="{ active: value === selectValues[index] }"
      type="button"
      @click="select(selectValues[index])"
    >
      {{ name }}
    </button>
  </div>
</template>

<script setup>
defineProps({
  value: {
    type: String,
    required: true
  },
  selectNames: {
    type: Array,
    required: true
  },
  selectValues: {
    type: Array,
    required: true
  }
})

const emit = defineEmits(['change'])

function select(val) {
  emit('change', val)
}
</script>

<style scoped src="./FtSortChips.css" />
