// Builds and returns a Card UI element for the classroom passed as parameter
export function buildCardForClassroom(classroom) {
  const item = `
    <h4 class="classroom-name">${classroom.name}</h4>
    <p>${classroom.name} - Available from ${classroom.slots[0].start} to ${classroom.slots[0].end}</p>
  `;

  return item;
}