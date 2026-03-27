import { useState, type FC, type CSSProperties } from "react";

type Props = {
  onAdd: (productCode: string) => void | Promise<void>;
};

const AddPopupWindow: FC<Props> = ({ onAdd }) => {
  const [open, setOpen] = useState(false);
  const [productCode, setProductCode] = useState("");

  const handleClose = () => {
    setOpen(false);
    setProductCode("");
  };

  const handleAdd = async () => {
    if (!productCode.trim()) return;
    await onAdd(productCode.trim());
    handleClose();
  };

  return (
    <>
      <button onClick={() => setOpen(true)} style={styles.openBtn}>
        + Add Product
      </button>

      {open && (
        <div style={styles.overlay}>
          <div style={styles.modal}>
            <h2 style={styles.title}>Add Product Code</h2>

            <input
              type="text"
              placeholder="Enter product code"
              value={productCode}
              onChange={(e) => setProductCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleAdd();
              }}
              style={styles.input}
              autoFocus
            />

            <div style={styles.actions}>
              <button onClick={handleClose} style={styles.cancelBtn}>
                Cancel
              </button>

              <button
                onClick={() => void handleAdd()}
                style={styles.addBtn}
                disabled={!productCode.trim()}
              >
                Add
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default AddPopupWindow;

const styles: Record<string, CSSProperties> = {
  openBtn: {
    padding: "10px 14px",
    background: "#111827",
    color: "#fff",
    borderRadius: "6px",
    border: "none",
    cursor: "pointer",
  },
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 9999,
  },
  modal: {
    background: "#fff",
    padding: "24px",
    borderRadius: "10px",
    width: "100%",
    maxWidth: "420px",
    boxShadow: "0 10px 30px rgba(0,0,0,0.2)",
  },
  title: {
    marginBottom: "16px",
    fontSize: "20px",
  },
  input: {
    width: "100%",
    padding: "10px 12px",
    fontSize: "16px",
    border: "1px solid #ccc",
    borderRadius: "6px",
    marginBottom: "16px",
    boxSizing: "border-box",
  },
  actions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: "10px",
  },
  cancelBtn: {
    padding: "10px 14px",
    background: "#f3f4f6",
    border: "none",
    borderRadius: "6px",
    cursor: "pointer",
  },
  addBtn: {
    padding: "10px 14px",
    background: "#2563eb",
    color: "#fff",
    border: "none",
    borderRadius: "6px",
    cursor: "pointer",
  },
};