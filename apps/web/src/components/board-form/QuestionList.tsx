import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  FORM_LIMITS,
  FORM_NAME_COLUMN_ID,
  type ColumnDef,
  type FormQuestion,
} from '@atrium/shared';
import { IconButton, Menu, MenuButton, MenuItem, Toggle } from '@vibe/core';
import { Add, Delete, Drag } from '@vibe/icons';
import classNames from 'classnames';
import {
  addableColumns,
  appendQuestion,
  canAddQuestion,
  patchQuestion,
  removeQuestion,
  reorderQuestions,
} from './form-model';
import { CommitField } from './CommitField';
import styles from './builder.module.css';

interface RowProps {
  question: FormQuestion;
  column: ColumnDef | undefined;
  onPatch: (patch: { label?: string; help?: string; required?: boolean }) => void;
  onRemove: () => void;
}

function QuestionRow({ question, column, onPatch, onRemove }: RowProps) {
  const isName = question.columnId === FORM_NAME_COLUMN_ID;
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: question.columnId,
    disabled: isName,
  });
  const kind = isName ? 'Item name' : (column?.type.replace('_', ' ') ?? 'Missing column');
  return (
    <li
      ref={setNodeRef}
      className={classNames(styles.question, isDragging && styles.dragging)}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      data-question-row={question.columnId}
    >
      {isName ? (
        <span className={styles.handleSpacer} />
      ) : (
        <button
          type="button"
          className={styles.handle}
          aria-label={`Drag to reorder ${question.label}`}
          {...attributes}
          {...listeners}
        >
          <Drag aria-hidden="true" />
        </button>
      )}
      <div className={styles.questionBody}>
        <div className={styles.questionKind}>
          {kind}
          {column && column.title !== question.label ? ` · ${column.title}` : ''}
        </div>
        <CommitField
          label="Question"
          value={question.label}
          maxLength={FORM_LIMITS.labelMax}
          required
          onCommit={(label) => onPatch({ label })}
        />
        <CommitField
          label="Help text"
          value={question.help ?? ''}
          maxLength={FORM_LIMITS.helpMax}
          placeholder="Optional"
          onCommit={(help) => onPatch({ help })}
        />
        <div className={styles.questionFooter}>
          <Toggle
            isSelected={question.required}
            disabled={isName}
            onChange={(on: boolean) => onPatch({ required: on })}
            aria-label={`Required: ${question.label}`}
            areLabelsHidden
          />
          <span>Required</span>
          {isName ? null : (
            <IconButton
              icon={Delete}
              kind="tertiary"
              size="small"
              aria-label={`Remove ${question.label}`}
              onClick={onRemove}
              className={styles.removeButton}
            />
          )}
        </div>
      </div>
    </li>
  );
}

interface ListProps {
  questions: readonly FormQuestion[];
  columns: readonly ColumnDef[];
  onChange: (questions: FormQuestion[]) => void;
}

/** The questions in order: the item name first and fixed, the rest draggable. */
export function QuestionList({ questions, columns, onChange }: ListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const byId = new Map(columns.map((c) => [c.id, c]));
  const addable = addableColumns(columns, questions);
  const canAdd = canAddQuestion(questions);

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    onChange(reorderQuestions(questions, String(active.id), String(over.id)));
  };

  return (
    <div className={styles.questionList}>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext
          items={questions.map((q) => q.columnId)}
          strategy={verticalListSortingStrategy}
        >
          <ul className={styles.questions} aria-label="Questions">
            {questions.map((q) => (
              <QuestionRow
                key={q.columnId}
                question={q}
                column={byId.get(q.columnId)}
                onPatch={(patch) => onChange(patchQuestion(questions, q.columnId, patch))}
                onRemove={() => onChange(removeQuestion(questions, q.columnId))}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      {!canAdd ? (
        <p className={styles.hint}>A form can ask up to {FORM_LIMITS.questions} questions.</p>
      ) : addable.length === 0 ? (
        <p className={styles.hint}>
          Every column that a form can ask about is already a question. Add a text, status, date or
          other column to the board to ask more.
        </p>
      ) : (
        <div className={styles.addRow}>
          <MenuButton
            component={Add}
            aria-label="Add question"
            closeMenuOnItemClick
            dialogPosition="bottom-start"
          >
            <Menu id="add-question-menu" size="medium">
              {addable.map((column) => (
                <MenuItem
                  key={column.id}
                  title={column.title}
                  onClick={() => onChange(appendQuestion(questions, column))}
                />
              ))}
            </Menu>
          </MenuButton>
          <span>Add question</span>
        </div>
      )}
    </div>
  );
}
